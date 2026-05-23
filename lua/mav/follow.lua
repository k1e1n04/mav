local M = {}

local function is_ignored_filetype(ignore_filetypes)
  local current = vim.bo.filetype
  for _, filetype in ipairs(ignore_filetypes or {}) do
    if filetype == current then
      return true
    end
  end

  return false
end

function M.follow(session, opts)
  if not session or type(session.cwd) ~= "string" or session.cwd == "" then
    return false, "missing cwd"
  end

  if is_ignored_filetype(opts.ignore_filetypes) then
    return false, "ignored filetype"
  end

  if vim.fn.isdirectory(session.cwd) ~= 1 then
    return false, "missing directory"
  end

  vim.cmd.lcd(vim.fn.fnameescape(session.cwd))

  if opts.notify_on_switch then
    local label = session.displayName or session.sessionId or "session"
    vim.notify(string.format("mav: %s -> %s", label, session.cwd))
  end

  return true
end

return M
