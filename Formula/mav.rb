class Mav < Formula
  desc "Multi-agent view — manage multiple AI CLI sessions in one terminal"
  homepage "https://github.com/k1e1n04/mav"
  url "https://github.com/k1e1n04/mav/archive/refs/tags/v0.1.28.tar.gz"
  sha256 "545264f13dc4e65fbbef75cdf344e3e01b877fcf10d53f1a0355f4ee57301fad"
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
