//go:build !windows

package main

// openApp runs the desktop app, which exists on Windows only. Elsewhere
// Cerlock opens the viewer in the browser.
func openApp() bool { return false }

// attachConsole is only needed by the Windows GUI build.
func attachConsole() {}
