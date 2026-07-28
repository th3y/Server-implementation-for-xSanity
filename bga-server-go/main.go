package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

var allowedExt = map[string]bool{
	".mpg":  true,
	".mpeg": true,
	".mp4":  true,
	".avi":  true,
	".webm": true,
	".mkv":  true,
	".mov":  true,
	".flv":  true,
	".f4v":  true,
	".ogv":   true,
	".wmv":   true,
	".nobga": true,
}

var throttleKBps int

func main() {
	addr := flag.String("addr", ":8080", "address to listen on")
	dir := flag.String("dir", "./videos", "root directory that holds the video files")
	kbps := flag.Int("kbps", 0, "simulate a slow connection, in KB/s (0 = unlimited; useful on localhost where downloads are otherwise instant and you can't see the client's progress overlay)")
	flag.Parse()

	root, err := filepath.Abs(*dir)
	if err != nil {
		log.Fatalf("bad -dir: %v", err)
	}
	if _, err := os.Stat(root); err != nil {
		log.Fatalf("dir does not exist: %s", root)
	}

	throttleKBps = *kbps
	if throttleKBps > 0 {
		log.Printf("Throttling downloads to ~%d KB/s", throttleKBps)
	}

	log.Printf("BGA server serving %s on %s", root, *addr)
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		handle(w, r, root)
	})
	log.Fatal(http.ListenAndServe(*addr, nil))
}

// throttledWriter paces Write() calls so a localhost transfer takes long enough to
// actually watch the client's download overlay, instead of finishing instantly.
type throttledWriter struct {
	http.ResponseWriter
	bytesPerSec int
}

func (t *throttledWriter) Write(p []byte) (int, error) {
	chunkSize := t.bytesPerSec / 10 // ~100ms worth of data per chunk
	if chunkSize <= 0 {
		chunkSize = 1024
	}
	flusher, _ := t.ResponseWriter.(http.Flusher)

	written := 0
	for written < len(p) {
		end := written + chunkSize
		if end > len(p) {
			end = len(p)
		}
		n, err := t.ResponseWriter.Write(p[written:end])
		written += n
		if err != nil {
			return written, err
		}
		if flusher != nil {
			flusher.Flush()
		}
		time.Sleep(100 * time.Millisecond)
	}
	return written, nil
}

func handle(w http.ResponseWriter, r *http.Request, root string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Use the "path" package (not "path/filepath") for URL-shaped input: filepath is
	// OS-dependent and on Windows turns "/" into "\", which makes a leading "//" look
	// like a UNC path ("\\host\share") and silently mangles the result.
	name := strings.ToLower(path.Base(path.Clean(r.URL.Path)))
	if name == "." || name == "/" || name == "" {
		http.NotFound(w, r)
		return
	}

	ext := path.Ext(name)
	if !allowedExt[ext] {
		log.Printf("reject %s (ext %q not allowed)", r.URL.Path, ext)
		http.NotFound(w, r)
		return
	}

	full := filepath.Join(root, name)
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		base := strings.TrimSuffix(name, ext)
		if info, e := os.Stat(filepath.Join(root, base+".nobga")); e == nil && !info.IsDir() {
			log.Printf("302 %s -> %s.nobga", name, base)
			http.Redirect(w, r, "/"+base+".nobga", http.StatusFound)
			return
		}
		log.Printf("404 %s", name)
		http.NotFound(w, r)
		return
	}

	log.Printf("%s -> %s (%d bytes)", r.RemoteAddr, name, info.Size())
	w.Header().Set("Cache-Control", "public, max-age=31536000")

	if throttleKBps > 0 {
		w = &throttledWriter{ResponseWriter: w, bytesPerSec: throttleKBps * 1024}
	}
	http.ServeFile(w, r, full)
}
