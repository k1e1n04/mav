local state = require("mav.state")
local follow = require("mav.follow")

local M = {}

local defaults = {
  state_file = vim.fn.expand("~/.local/state/mav/current-session.json"),
  auto_follow = true,
  poll_interval_ms = 500,
  notify_on_switch = false,
  ignore_filetypes = {},
}

M._opts = vim.deepcopy(defaults)
M._timer = nil
M._last_updated = nil
M._last_session = nil

local function normalize_path(path)
  if type(path) ~= "string" or path == "" then
    return nil
  end

  local uv = vim.uv or vim.loop
  local real = uv and uv.fs_realpath(path) or nil
  return real or path
end

local function current_cwd_matches(session)
  if not session or type(session.cwd) ~= "string" or session.cwd == "" then
    return false
  end

  return normalize_path(vim.fn.getcwd()) == normalize_path(session.cwd)
end

local function read_session()
  return state.read(M._opts.state_file)
end

local function cache_session(session)
  M._last_session = session
  M._last_updated = session and session.updatedAt or nil
end

function M.stop()
  if not M._timer then
    return
  end

  M._timer:stop()
  M._timer:close()
  M._timer = nil
end

function M.poll_once()
  local session = read_session()
  if not session then
    return nil
  end

  if session.updatedAt == M._last_updated then
    if M._opts.auto_follow and not current_cwd_matches(M._last_session) then
      follow.follow(M._last_session, M._opts)
    end
    return M._last_session
  end

  cache_session(session)

  if M._opts.auto_follow then
    follow.follow(session, M._opts)
  end

  return session
end

function M.follow_now()
  local session = read_session()
  if not session then
    return nil
  end

  cache_session(session)
  follow.follow(session, M._opts)
  return session
end

function M.status()
  return M._last_session or read_session()
end

function M.setup(opts)
  M.stop()
  M._opts = vim.tbl_deep_extend("force", vim.deepcopy(defaults), opts or {})

  if not M._opts.auto_follow then
    return M
  end

  M._timer = vim.uv.new_timer()
  M._timer:start(
    0,
    M._opts.poll_interval_ms,
    vim.schedule_wrap(function()
      M.poll_once()
    end)
  )

  return M
end

return M
