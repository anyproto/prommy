//go:build embedcss

package prommy

import (
	"embed"
)

// tailwindCSS contains the embedded tailwind.css.gz file
//
//go:embed static/tailwind.css.gz
var tailwindCSS embed.FS

// IsTailwindEmbedded returns true because this build includes embedded Tailwind CSS
func IsTailwindEmbedded() bool {
	return true
}

// GetTailwindFS returns the filesystem containing the embedded Tailwind CSS
func GetTailwindFS() embed.FS {
	return tailwindCSS
}
