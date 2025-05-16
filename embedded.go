package prommy

import (
	"embed"
	"io/fs"
)

//go:embed static
var staticFiles embed.FS

// embeddedFiles holds the embedded static files for serving.
var embeddedFiles, _ = fs.Sub(staticFiles, "static")
