class Mav < Formula
  desc "Multi-agent view — manage multiple AI CLI sessions in one terminal"
  homepage "https://github.com/k1e1n04/mav"
  url "https://github.com/k1e1n04/mav/archive/refs/tags/v0.1.33.tar.gz"
  sha256 "53de1924725b4602f7f5bae5e257bc54152ba2412606abb0775ad310f6be21cb"
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
