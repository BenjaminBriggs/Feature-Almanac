// Prints the Homebrew formula for a published version:
//   node scripts/homebrew-formula.mjs <version> <sha256 of the npm tarball>
// The release workflow writes it to Formula/almanac.rb in BenjaminBriggs/homebrew-tap.
const [version, sha256] = process.argv.slice(2)
if (/^\d+\.\d+\.\d+$/.test(version ?? '') === false || /^[0-9a-f]{64}$/.test(sha256 ?? '') === false) {
  console.error('usage: homebrew-formula.mjs <version> <sha256>')
  process.exit(2)
}

process.stdout.write(`class Almanac < Formula
  desc "Git-stored spec of everything an app does, kept next to the code"
  homepage "https://github.com/BenjaminBriggs/Feature-Almanac"
  url "https://registry.npmjs.org/feature-almanac/-/feature-almanac-${version}.tgz"
  sha256 "${sha256}"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/almanac --version").strip
    system bin/"almanac", "init", "--product", "Test", "--prefix", "TS", "--platforms", "ios"
    system bin/"almanac", "lint"
    system bin/"almanac", "site", "build", "--out", "site"
    assert_path_exists testpath/"site/index.html"
  end
end
`)
