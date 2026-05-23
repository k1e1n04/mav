local M = {}

function M.read(path)
  local expanded = vim.fn.expand(path)
  if vim.fn.filereadable(expanded) == 0 then
    return nil
  end

  local lines = vim.fn.readfile(expanded)
  if #lines == 0 then
    return nil
  end

  local ok, data = pcall(vim.json.decode, table.concat(lines, "\n"))
  if not ok or type(data) ~= "table" then
    return nil
  end

  return data
end

return M
