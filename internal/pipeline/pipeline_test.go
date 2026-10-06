package pipeline

import (
	"bytes"
	"compress/gzip"
	"io"
	"testing"

	"github.com/klauspost/compress/zstd"
)

func TestFingerprint(t *testing.T) {
	head := bytes.Repeat([]byte("x"), FingerprintBytes+100)
	a := Fingerprint(5_000_000, head)
	if len(a) != 20 {
		t.Fatalf("length %d", len(a))
	}
	// Only the first megabyte counts.
	if b := Fingerprint(5_000_000, head[:FingerprintBytes]); a != b {
		t.Fatal("bytes after the first megabyte changed the fingerprint")
	}
	if c := Fingerprint(5_000_001, head); a == c {
		t.Fatal("size is not part of the fingerprint")
	}
	// Same value the web client computes for a 3 byte file containing "abc".
	if got := Fingerprint(3, []byte("abc")); got != "ce91dc5eec0139adf091" {
		t.Fatalf("fingerprint = %s", got)
	}
}

func TestDecompress(t *testing.T) {
	demo := append([]byte("PBDEMS2\x00"), bytes.Repeat([]byte{1, 2, 3}, 1000)...)

	var gz bytes.Buffer
	w := gzip.NewWriter(&gz)
	w.Write(demo)
	w.Close()

	var zs bytes.Buffer
	zw, _ := zstd.NewWriter(&zs)
	zw.Write(demo)
	zw.Close()

	for name, in := range map[string][]byte{"raw": demo, "gzip": gz.Bytes(), "zstd": zs.Bytes()} {
		r, done, err := Decompress(bytes.NewReader(in))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		out, _ := io.ReadAll(r)
		done()
		if !bytes.Equal(out, demo) {
			t.Fatalf("%s: got %d bytes back", name, len(out))
		}
	}

	if _, _, err := Decompress(bytes.NewReader([]byte("HL2DEMO\x00...."))); err == nil {
		t.Fatal("CS:GO demos should be rejected")
	}
	if _, _, err := Decompress(bytes.NewReader([]byte("hello world"))); err != ErrNotDemo {
		t.Fatalf("err = %v", err)
	}
}
