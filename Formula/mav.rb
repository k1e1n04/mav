class Mav < Formula
  desc "Multi-agent view — manage multiple AI CLI sessions in one terminal"
  homepage "https://github.com/k1e1n04/mav"
  url "https://github.com/k1e1n04/mav/archive/refs/tags/v0.1.29.tar.gz"
  sha256 "d704858cf80758f30597d45d7b866c0fd83a10c5a2696f68c082e2b287ac6bb5"
  license "MIT"
  head "https://github.com/k1e1n04/mav.git", branch: "main"

  depends_on "node"

  def install
    system "npm", "ci"
    system "npm", "run", "build"
    system "npm", "prune", "--omit=dev"

    libexec.install Dir["*"]
    (bin/"mav").write_env_script libexec/"dist/bin/mav.js",
                                 PATH: "#{Formula["node"].opt_bin}:$PATH"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/mav --version")
  end
end
