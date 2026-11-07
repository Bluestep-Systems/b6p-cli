/**
 * Whether `--help` output lists `name` as a command: a line of the "Commands:" section that starts
 * with the name. Matching the bare word anywhere is not enough - option text mentions commands
 * ("see script push --overwrite"), so the check would pass with the command deleted.
 * @param {string} help The text `--help` printed
 * @param {string} name The command to look for
 * @returns {boolean}
 */
export function helpListsCommand(help, name) {
  const lines = help.split(/\r?\n/);
  const start = lines.findIndex((l) => /^Commands:\s*$/.test(l));
  if (start === -1) {
    return false;
  }
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") {
      break;
    }
    if (new RegExp(`^\\s+${name}(\\s|$)`).test(line)) {
      return true;
    }
  }
  return false;
}
