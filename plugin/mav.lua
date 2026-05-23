if vim.g.loaded_mav_plugin == 1 then
  return
end

vim.g.loaded_mav_plugin = 1

vim.api.nvim_create_user_command("MavFollowNow", function()
  require("mav").follow_now()
end, {})

vim.api.nvim_create_user_command("MavStatus", function()
  local session = require("mav").status()
  if not session then
    print("mav: no selected session state")
    return
  end

  print(string.format(
    "%s (%s) -> %s",
    session.displayName or session.sessionId or "unknown",
    session.agentType or "unknown",
    session.cwd or ""
  ))
end, {})
