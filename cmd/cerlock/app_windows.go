//go:build windows

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/webviewloader"
	"golang.org/x/sys/windows"
)

func init() {
	// The window and WebView2 must stay on the thread that created them.
	// Locking here keeps main on the startup thread.
	runtime.LockOSThread()
}

const webview2URL = "https://developer.microsoft.com/microsoft-edge/webview2/"

// openApp runs Cerlock as a desktop app: the server in the background and
// the viewer in its own window. It is used when the exe is started without
// arguments, for example by double clicking it or from a taskbar pin.
func openApp() bool {
	dataDir := defaultDataDir()
	logPath := filepath.Join(dataDir, "cerlock.log")
	if f, err := openLog(logPath, appLogSize); err == nil {
		os.Stdout, os.Stderr = f, f
		log.SetOutput(f)
		debug.SetCrashOutput(f, debug.CrashOptions{})
	}
	log.SetFlags(log.Ldate | log.Ltime)
	log.Printf("Cerlock %s starting", version)
	if err := runApp(dataDir); err != nil {
		log.Print(err)
		messageBox(fmt.Sprintf("Cerlock ran into a problem and has to close.\n\n%v\n\nMore details are in the log file:\n%s", err, logPath), windows.MB_OK|windows.MB_ICONERROR)
		os.Exit(1)
	}
	log.Print("Cerlock closed")
	return true
}

func runApp(dataDir string) error {
	addr, running := appAddr(portFree, isCerlock)
	if running {
		return useRunning(addr, dataDir)
	}
	if addr == "" {
		var err error
		if addr, err = anyFreeAddr(); err != nil {
			return err
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	srv := startServer(ctx, "-addr", addr)
	if err := waitReady(addr, srv.done, time.Minute); err != nil {
		stopErr := srv.stop(cancel)
		if isCerlock(addr) {
			// Another copy was started at the same moment and got the port.
			return useRunning(addr, dataDir)
		}
		if stopErr != nil {
			return stopErr
		}
		return err
	}
	showApp("http://"+addr+"/", dataDir, srv.done)
	return srv.stop(cancel)
}

// useRunning shows a Cerlock that is already running: its window when it
// has one, or a new window on its server.
func useRunning(addr, dataDir string) error {
	log.Printf("Cerlock is already running on %s", addr)
	if focusAppWindow() {
		return nil
	}
	showApp("http://"+addr+"/", dataDir, nil)
	return nil
}

// showApp shows url in the app window until the window is closed or
// stopped is closed. Without WebView2 it uses the browser instead. A nil
// stopped means the server belongs to another Cerlock.
func showApp(url, dataDir string, stopped <-chan struct{}) {
	if v, err := webviewloader.GetInstalledVersion(); err != nil || v == "" {
		log.Printf("WebView2 runtime not found, using the browser (%v)", err)
		showInBrowser(url, stopped)
		return
	}
	w, closed := newWindow(dataDir)
	if closed {
		return
	}
	if w == nil {
		log.Print("WebView2 did not start, using the browser")
		hideThreadWindows()
		showInBrowser(url, stopped)
		return
	}
	defer w.Destroy()
	hwnd := uintptr(w.Window())
	setWindowIcons(hwnd)
	w.Navigate(url)

	quit := make(chan struct{})
	defer close(quit)
	go func() {
		select {
		case <-stopped:
			// The loop and the window belong to the UI thread.
			w.Dispatch(func() {
				procShowWindow.Call(hwnd, swHide)
				w.Terminate()
			})
		case <-quit:
		}
	}()
	// Closing the window destroys it and ends the loop.
	w.Run()
}

// newWindow opens the app window. closed is true when the window was closed
// while WebView2 was still starting.
func newWindow(dataDir string) (w webview2.WebView, closed bool) {
	defer func() {
		// go-webview2 panics when its window is closed before WebView2 is
		// ready.
		if r := recover(); r != nil {
			log.Printf("window closed while starting: %v", r)
			hideThreadWindows()
			w, closed = nil, true
		}
	}()
	sw, sh := systemMetric(smCxScreen), systemMetric(smCyScreen)
	width, height := windowSize(sw, sh, systemDPI())
	w = webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:  filepath.Join(dataDir, "webview"),
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  "Cerlock",
			Width:  uint(width),
			Height: uint(height),
			IconId: appIconID,
			Center: sw > 0 && sh > 0,
		},
	})
	return w, false
}

// showInBrowser is used when WebView2 is missing. It opens the viewer in the
// default browser and, when this process runs the server, keeps it running
// until the user closes the message.
func showInBrowser(url string, stopped <-chan struct{}) {
	text := "Cerlock needs the Microsoft Edge WebView2 Runtime to open in its own window. " +
		"It is free from Microsoft:\n\n" + webview2URL + "\n\n" +
		"Open the download page now? Until it is installed, Cerlock opens in your web browser."
	if messageBox(text, windows.MB_YESNO|windows.MB_ICONINFORMATION) == idYes {
		openBrowser(webview2URL)
	}
	openBrowser(url)
	if stopped == nil {
		return
	}
	messageBox("Cerlock is running in your web browser at "+url+"\n\nClose this message to quit Cerlock.", windows.MB_OK|windows.MB_ICONINFORMATION)
}

// attachConsole sends output to the terminal Cerlock was started from. The
// release exe is a GUI program, so it gets no console of its own.
func attachConsole() {
	if r, _, _ := procAttachConsole.Call(attachParentProcess); r == 0 {
		return // no parent console, or this exe already has one
	}
	name, _ := windows.UTF16PtrFromString("CONOUT$")
	h, err := windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE, windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		return
	}
	con := os.NewFile(uintptr(h), "CONOUT$")
	if !redirected(windows.STD_OUTPUT_HANDLE) {
		os.Stdout = con
		windows.SetStdHandle(windows.STD_OUTPUT_HANDLE, h)
	}
	if !redirected(windows.STD_ERROR_HANDLE) {
		os.Stderr = con
		windows.SetStdHandle(windows.STD_ERROR_HANDLE, h)
	}
	log.SetOutput(os.Stderr)
}

// redirected reports whether a standard handle already goes to a file or a
// pipe, as in "cerlock version > out.txt".
func redirected(std uint32) bool {
	h, err := windows.GetStdHandle(std)
	if err != nil || h == 0 || h == windows.InvalidHandle {
		return false
	}
	t, err := windows.GetFileType(h)
	return err == nil && (t == windows.FILE_TYPE_DISK || t == windows.FILE_TYPE_PIPE)
}

const (
	appIconID           = 1 // the "#1" icon group in winres/winres.json
	attachParentProcess = uintptr(^uint32(0))

	smCxScreen = 0
	smCyScreen = 1
	smCxIcon   = 11
	smCyIcon   = 12
	smCxSmIcon = 49
	smCySmIcon = 50

	imageIcon = 1
	lrShared  = 0x8000
	wmSetIcon = 0x0080
	iconSmall = 0
	iconBig   = 1
	swHide    = 0
	swRestore = 9
	idYes     = 6
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procAttachConsole       = kernel32.NewProc("AttachConsole")
	procGetSystemMetrics    = user32.NewProc("GetSystemMetrics")
	procGetDpiForSystem     = user32.NewProc("GetDpiForSystem")
	procLoadImageW          = user32.NewProc("LoadImageW")
	procSendMessageW        = user32.NewProc("SendMessageW")
	procShowWindow          = user32.NewProc("ShowWindow")
	procIsIconic            = user32.NewProc("IsIconic")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procFindWindowW         = user32.NewProc("FindWindowW")
	procEnumThreadWindows   = user32.NewProc("EnumThreadWindows")
)

func messageBox(text string, flags uint32) int32 {
	t, _ := windows.UTF16PtrFromString(text)
	c, _ := windows.UTF16PtrFromString("Cerlock")
	r, _ := windows.MessageBox(0, t, c, flags|windows.MB_SETFOREGROUND)
	return r
}

func systemMetric(index uintptr) int {
	r, _, _ := procGetSystemMetrics.Call(index)
	return int(int32(r))
}

// systemDPI returns the screen scaling as dots per inch, 96 being 100%.
func systemDPI() int {
	if procGetDpiForSystem.Find() != nil {
		return 96 // older than Windows 10 1607
	}
	r, _, _ := procGetDpiForSystem.Call()
	return int(r)
}

// setWindowIcons gives the window the icon sizes made for the title bar and
// the taskbar, so Windows does not have to scale one of them.
func setWindowIcons(hwnd uintptr) {
	var inst windows.Handle
	if windows.GetModuleHandleEx(0, nil, &inst) != nil {
		return
	}
	for _, ic := range []struct{ kind, cx, cy uintptr }{
		{iconSmall, smCxSmIcon, smCySmIcon},
		{iconBig, smCxIcon, smCyIcon},
	} {
		w, h := systemMetric(ic.cx), systemMetric(ic.cy)
		icon, _, _ := procLoadImageW.Call(uintptr(inst), appIconID, imageIcon, uintptr(w), uintptr(h), lrShared)
		if icon != 0 {
			procSendMessageW.Call(hwnd, wmSetIcon, ic.kind, icon)
		}
	}
}

// focusAppWindow brings an open Cerlock window to the front.
func focusAppWindow() bool {
	class, _ := windows.UTF16PtrFromString("webview")
	title, _ := windows.UTF16PtrFromString("Cerlock")
	hwnd, _, _ := procFindWindowW.Call(uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(title)))
	if hwnd == 0 {
		return false
	}
	if r, _, _ := procIsIconic.Call(hwnd); r != 0 {
		procShowWindow.Call(hwnd, swRestore)
	}
	procSetForegroundWindow.Call(hwnd)
	return true
}

// hideThreadWindows hides a window left behind when WebView2 failed to
// start in it. Destroying it would post a quit message, and that closes the
// next message box right away.
func hideThreadWindows() {
	cb := windows.NewCallback(func(hwnd, _ uintptr) uintptr {
		procShowWindow.Call(hwnd, swHide)
		return 1
	})
	procEnumThreadWindows.Call(uintptr(windows.GetCurrentThreadId()), cb, 0)
}
