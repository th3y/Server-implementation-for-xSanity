package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"hash/crc32"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

type packEntry struct {
	Id      string `json:"id"`
	Name    string `json:"name"`
	Author  string `json:"author"`
	Size    int64  `json:"size"`
	Songs   int    `json:"songs"`
	Image   string `json:"image,omitempty"`
	Url     string `json:"url"`
	Type    string `json:"type"`
	Version string `json:"version"`
	Crc32   string `json:"crc32,omitempty"`
}

type catalog struct {
	Name  string      `json:"name"`
	Packs []packEntry `json:"packs"`
}

type packMeta struct {
	Name    string `json:"name"`
	Author  string `json:"author"`
	Songs   int    `json:"songs"`
	Type    string `json:"type"`
	Version string `json:"version"`
}

type crcCacheEntry struct {
	Mtime int64  `json:"mtime"`
	Size  int64  `json:"size"`
	Crc32 string `json:"crc32"`
}

var (
	rootDir      string
	catalogName  string
	throttleKBps int
)

func main() {
	addr := flag.String("addr", ":8090", "address to listen on")
	dir := flag.String("dir", ".", "root dir containing packs/ and thumbs/")
	name := flag.String("name", "Local Pack Repo", "catalog display name")
	kbps := flag.Int("kbps", 0, "throttle downloads in KB/s (0 = unlimited; use it to watch the progress overlay)")
	flag.Parse()

	abs, err := filepath.Abs(*dir)
	if err != nil {
		log.Fatalf("bad -dir: %v", err)
	}
	rootDir = abs
	catalogName = *name
	throttleKBps = *kbps

	if _, err := os.Stat(filepath.Join(rootDir, "packs")); err != nil {
		log.Printf("warning: %s does not exist; create it and drop .zip packs inside", filepath.Join(rootDir, "packs"))
	}

	log.Printf("Pack server serving %s on %s", rootDir, *addr)
	if throttleKBps > 0 {
		log.Printf("Throttling downloads to ~%d KB/s", throttleKBps)
	}

	http.HandleFunc("/catalog.json", handleCatalog)
	http.HandleFunc("/packs/", handleFile("packs", map[string]bool{".zip": true}))
	http.HandleFunc("/thumbs/", handleFile("thumbs", map[string]bool{".png": true, ".jpg": true, ".jpeg": true}))
	log.Fatal(http.ListenAndServe(*addr, nil))
}

func scheme(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	if p := r.Header.Get("X-Forwarded-Proto"); p != "" {
		return p
	}
	return "http"
}

func cachedCrc32(zipPath string, info os.FileInfo) string {
	cachePath := zipPath + ".crc"
	mtime := info.ModTime().Unix()
	size := info.Size()

	if cb, err := os.ReadFile(cachePath); err == nil {
		var c crcCacheEntry
		if json.Unmarshal(cb, &c) == nil && c.Mtime == mtime && c.Size == size {
			return c.Crc32
		}
	}

	f, err := os.Open(zipPath)
	if err != nil {
		return ""
	}
	defer f.Close()

	h := crc32.NewIEEE()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	sum := fmt.Sprintf("%08x", h.Sum32())

	entry := crcCacheEntry{Mtime: mtime, Size: size, Crc32: sum}
	if eb, err := json.Marshal(entry); err == nil {
		_ = os.WriteFile(cachePath, eb, 0644)
	}
	return sum
}

func handleCatalog(w http.ResponseWriter, r *http.Request) {
	static := filepath.Join(rootDir, "catalog.json")
	if info, err := os.Stat(static); err == nil && !info.IsDir() {
		http.ServeFile(w, r, static)
		return
	}

	base := scheme(r) + "://" + r.Host
	c := catalog{Name: catalogName, Packs: []packEntry{}}

	zips, _ := filepath.Glob(filepath.Join(rootDir, "packs", "*.zip"))
	for _, z := range zips {
		info, err := os.Stat(z)
		if err != nil || info.IsDir() {
			continue
		}
		id := strings.TrimSuffix(filepath.Base(z), ".zip")

		p := packEntry{
			Id:      id,
			Name:    id,
			Size:    info.Size(),
			Url:     base + "/packs/" + id + ".zip",
			Type:    "songpackage",
			Version: "1.0.0",
		}

		if mb, err := os.ReadFile(filepath.Join(rootDir, "packs", id+".json")); err == nil {
			var m packMeta
			if json.Unmarshal(mb, &m) == nil {
				if m.Name != "" {
					p.Name = m.Name
				}
				p.Author = m.Author
				p.Songs = m.Songs
				if m.Type == "userpackage" {
					p.Type = "userpackage"
				}
				if m.Version != "" {
					p.Version = m.Version
				}
			}
		}

		p.Crc32 = cachedCrc32(z, info)

		for _, ext := range []string{".png", ".jpg", ".jpeg"} {
			if _, err := os.Stat(filepath.Join(rootDir, "thumbs", id+ext)); err == nil {
				p.Image = base + "/thumbs/" + id + ext
				break
			}
		}

		c.Packs = append(c.Packs, p)
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(c)
	log.Printf("catalog.json -> %d pack(s)", len(c.Packs))
}

func handleFile(subDir string, allowedExt map[string]bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		name := strings.ToLower(path.Base(path.Clean(r.URL.Path)))
		ext := path.Ext(name)
		if name == "." || name == "/" || name == "" || !allowedExt[ext] {
			log.Printf("reject %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}

		full := filepath.Join(rootDir, subDir, name)
		info, err := os.Stat(full)
		if err != nil || info.IsDir() {
			log.Printf("404 %s/%s", subDir, name)
			http.NotFound(w, r)
			return
		}

		log.Printf("%s -> %s/%s (%d bytes)", r.RemoteAddr, subDir, name, info.Size())
		w.Header().Set("Cache-Control", "public, max-age=31536000")

		if throttleKBps > 0 && subDir == "packs" {
			w = &throttledWriter{ResponseWriter: w, bytesPerSec: throttleKBps * 1024}
		}
		http.ServeFile(w, r, full)
	}
}

type throttledWriter struct {
	http.ResponseWriter
	bytesPerSec int
}

func (t *throttledWriter) Write(p []byte) (int, error) {
	chunkSize := t.bytesPerSec / 10
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
