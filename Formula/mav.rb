class Mav < Formula
  desc "Multi-agent view — manage multiple AI CLI sessions in one terminal"
  homepage "https://github.com/k1e1n04/mav"
  url "https://github.com/k1e1n04/mav/archive/refs/tags/v0.1.7.tar.gz"
  sha256 "07b702f23f857e20a9d65b0f0c4ff80f8065c9314722f5148d2369e590f326c4"
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
