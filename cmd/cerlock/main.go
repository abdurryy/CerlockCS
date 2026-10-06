// Command cerlock parses CS2 demos and serves the 2D replay viewer.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/abdurryy/CerlockCS/internal/pipeline"
	"github.com/abdurryy/CerlockCS/internal/server"
	"github.com/abdurryy/CerlockCS/web"
)

var version = "dev"

const usage = `cerlock - CS2 demo review

Usage:
  cerlock serve [flags]          start the viewer (default)
  cerlock parse [flags] <demo>   parse a demo into a replay file
  cerlock version

Run "cerlock <command> -h" for the flags of a command.
`

func main() {
	log.SetFlags(log.Ltime)
	args := os.Args[1:]
	if len(args) == 0 {
		// Started without arguments, most likely by double clicking the
		// binary, so open the viewer right away.
		args = []string{"--open"}
	}
	cmd := "serve"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cmd, args = args[0], args[1:]
	}
	var err error
	switch cmd {
	case "serve":
		err = serve(args)
	case "parse":
		err = parseCmd(args)
	case "version":
		fmt.Println(version)
	case "help":
		fmt.Print(usage)
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		log.Fatal(err)
	}
}

func defaultDataDir() string {
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".cerlock")
	}
	return ".cerlock"
}

// gameReplayDirs returns the CS2 replay folders of a default Steam install,
// so demos downloaded in game show up without any setup.
func gameReplayDirs() []string {
	rel := filepath.Join("steamapps", "common", "Counter-Strike Global Offensive", "game", "csgo", "replays")
	var roots []string
	if runtime.GOOS == "windows" {
		for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles"} {
			if p := os.Getenv(env); p != "" {
				roots = append(roots, filepath.Join(p, "Steam"))
			}
		}
	} else if home, err := os.UserHomeDir(); err == nil {
		roots = append(roots, filepath.Join(home, ".steam", "steam"), filepath.Join(home, ".local", "share", "Steam"))
	}
	var out []string
	seen := map[string]bool{}
	for _, r := range roots {
		dir := filepath.Join(r, rel)
		real, err := filepath.EvalSymlinks(dir)
		if err != nil || seen[real] {
			continue
		}
		if st, err := os.Stat(real); err == nil && st.IsDir() {
			seen[real] = true
			out = append(out, dir)
		}
	}
	return out
}

type listFlag []string

func (l *listFlag) String() string { return strings.Join(*l, ",") }
func (l *listFlag) Set(v string) error {
	*l = append(*l, v)
	return nil
}

func serve(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fs.String("addr", "127.0.0.1:7350", "address to listen on")
	data := fs.String("data", defaultDataDir(), "where replays and map images are stored")
	var demos listFlag
	fs.Var(&demos, "demos", "folder with demos to list in the library (repeatable)")
	watch := fs.Bool("watch", true, "parse new demos in the demo folders in the background")
	offline := fs.Bool("offline", false, "never download radar images or icons")
	workers := fs.Int("workers", max(1, runtime.NumCPU()/2), "demos parsed at the same time")
	sample := fs.Int("sample", 2, "ticks between stored frames")
	webDir := fs.String("web", "", "serve the frontend from this folder instead of the embedded build")
	open := fs.Bool("open", false, "open the viewer in the browser")
	fs.Parse(args)
	if len(demos) == 0 {
		demos = gameReplayDirs()
	}

	cfg := server.Config{
		Addr:           *addr,
		DataDir:        *data,
		DemoDirs:       demos,
		Watch:          *watch,
		Offline:        *offline,
		Workers:        *workers,
		SampleInterval: *sample,
		Static:         web.Files(),
	}
	if *webDir != "" {
		cfg.Static = os.DirFS(*webDir)
	}
	srv, err := server.New(cfg)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	url := "http://" + *addr
	log.Printf("CerlockCS %s listening on %s", version, url)
	if len(demos) > 0 {
		log.Printf("watching %s", strings.Join(demos, ", "))
	}
	if *open {
		go openBrowser(url)
	}
	return srv.Run(ctx)
}

func parseCmd(args []string) error {
	fs := flag.NewFlagSet("parse", flag.ExitOnError)
	out := fs.String("o", "", "output file (default: <demo>.crlk.gz)")
	sample := fs.Int("sample", 2, "ticks between stored frames")
	quiet := fs.Bool("q", false, "no progress output")
	fs.Parse(args)
	if fs.NArg() != 1 {
		return fmt.Errorf("usage: cerlock parse [flags] <demo>")
	}
	in := fs.Arg(0)
	if *out == "" {
		base := in
		for _, ext := range []string{".gz", ".bz2", ".zst", ".dem"} {
			base = strings.TrimSuffix(base, ext)
		}
		*out = base + ".crlk.gz"
	}

	f, err := os.Open(in)
	if err != nil {
		return err
	}
	defer f.Close()
	st, _ := f.Stat()
	w, err := os.Create(*out)
	if err != nil {
		return err
	}

	start := time.Now()
	progress := func(p float32) {
		if !*quiet {
			fmt.Fprintf(os.Stderr, "\rparsing %3.0f%%", p*100)
		}
	}
	sum, err := pipeline.Run(f, w, pipeline.Options{SampleInterval: *sample, Progress: progress})
	if cerr := w.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(*out)
		return err
	}
	if !*quiet {
		fmt.Fprintln(os.Stderr)
	}
	ost, _ := os.Stat(*out)
	m := sum.Match
	fmt.Printf("%s  %s %d - %d %s  (%d rounds)\n", sum.Map, sum.Teams[0].Name, sum.Teams[0].Score, sum.Teams[1].Score, sum.Teams[1].Name, sum.Rounds)
	fmt.Printf("%d players, %d kills, %d grenades, %d engagements\n", len(m.Players), len(m.Kills), len(m.Grenades), len(m.Engagements))
	fmt.Printf("%.1f MB demo -> %.1f MB replay in %s\n", float64(st.Size())/1e6, float64(ost.Size())/1e6, time.Since(start).Round(time.Millisecond))
	return nil
}

func openBrowser(url string) {
	time.Sleep(300 * time.Millisecond)
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	cmd.Start()
}
