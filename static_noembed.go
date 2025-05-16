//go:build !embedcss

package prommy

import (
	"embed"
)

// IsTailwindEmbedded returns false because this build does not include embedded Tailwind CSS
func IsTailwindEmbedded() bool {
	return false
}

// GetTailwindFS returns nil as there is no embedded Tailwind CSS in this build
func GetTailwindFS() embed.FS {
	// Return an empty filesystem
	return embed.FS{}
}
