// Shell completion scripts for `ofini completion <shell>`: commands, their options and kinds for `ofini new`; command
// groups (`ofini proto <command>`) complete their subcommands and each subcommand's options; files are completed by
// the shell itself.
import { GLOBAL_FLAGS } from "./args.mjs";
import { NEW_KINDS } from "./project.mjs";

const flagsOf = (cmd) => [...Object.keys(cmd.flags), ...Object.keys(GLOBAL_FLAGS)].map((f) => `--${f}`);
const quote = (s) => s.replace(/'/g, "");

export function completionScript(shell, commands) {
  const names = Object.keys(commands);
  const per = Object.fromEntries(names.map((n) => [n, flagsOf(commands[n])]));
  const groups = names.filter((n) => commands[n].subcommands);
  const subs = Object.fromEntries(groups.map((g) => [g, Object.keys(commands[g].subcommands)]));
  const subFlags = Object.fromEntries(groups.flatMap((g) => subs[g].map((s) => [`${g} ${s}`, flagsOf(commands[g].subcommands[s])])));
  if (shell === "bash") {
    const cases = names.map((n) => `    ${n}) opts="${per[n].join(" ")}" ;;`).join("\n");
    const subCases = Object.entries(subFlags).map(([k, v]) => `    "${k}") opts="${v.join(" ")}" ;;`).join("\n");
    const groupLines = groups.map((g) => `  if [ "$cmd" = "${g}" ] && [ "$COMP_CWORD" -eq 2 ]; then COMPREPLY=( $(compgen -W "${subs[g].join(" ")} help" -- "$cur") ); return; fi`).join("\n");
    return `# ofini completion for bash. Add to ~/.bashrc:  eval "$(ofini completion bash)"
_ofini() {
  local cur=\${COMP_WORDS[COMP_CWORD]} cmd=\${COMP_WORDS[1]} sub=\${COMP_WORDS[2]} opts=""
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${names.join(" ")}" -- "$cur") ); return
  fi
${groupLines}
  case "$cmd" in
${cases}
  esac
  case "$cmd $sub" in
${subCases}
  esac
  if [ "$cmd" = "new" ] && [ "$COMP_CWORD" -eq 2 ]; then COMPREPLY=( $(compgen -W "${NEW_KINDS.join(" ")}" -- "$cur") ); return; fi
  if [ "$cmd" = "completion" ]; then COMPREPLY=( $(compgen -W "bash zsh fish powershell" -- "$cur") ); return; fi
  if [[ "$cur" == -* ]]; then COMPREPLY=( $(compgen -W "$opts" -- "$cur") ); else COMPREPLY=( $(compgen -f -- "$cur") ); fi
}
complete -o filenames -F _ofini ofini
`;
  }
  if (shell === "zsh") {
    const cmds = names.map((n) => `'${n}:${quote(commands[n].summary)}'`).join(" ");
    const cases = names.map((n) => `    ${n}) _arguments '*:file:_files' ${per[n].map((f) => `'${f}'`).join(" ")} ;;`).join("\n");
    const groupLines = groups
      .map((g) => {
        const list = subs[g].map((s) => `'${s}:${quote(commands[g].subcommands[s].summary)}'`).join(" ");
        const sc = subs[g].map((s) => `      ${s}) _arguments '*:file:_files' ${subFlags[`${g} ${s}`].map((f) => `'${f}'`).join(" ")} ;;`).join("\n");
        return `  if [[ $words[2] == ${g} ]]; then
    if (( CURRENT == 3 )); then local -a subs; subs=(${list}); _describe 'command' subs; return; fi
    case $words[3] in
${sc}
    esac
    return
  fi`;
      })
      .join("\n");
    return `#compdef ofini
# ofini completion for zsh. Add to ~/.zshrc:  eval "$(ofini completion zsh)"
_ofini() {
  if (( CURRENT == 2 )); then
    local -a cmds; cmds=(${cmds}); _describe 'command' cmds; return
  fi
  if [[ $words[2] == new && CURRENT == 3 ]]; then compadd ${NEW_KINDS.join(" ")}; return; fi
  if [[ $words[2] == completion ]]; then compadd bash zsh fish powershell; return; fi
${groupLines}
  case $words[2] in
${cases}
  esac
}
compdef _ofini ofini
`;
  }
  if (shell === "fish") {
    const lines = [`# ofini completion for fish:  ofini completion fish > ~/.config/fish/completions/ofini.fish`, "complete -c ofini -f"];
    for (const n of names) lines.push(`complete -c ofini -n "__fish_use_subcommand" -a ${n} -d '${quote(commands[n].summary)}'`);
    for (const n of names) if (!commands[n].subcommands) for (const f of per[n]) lines.push(`complete -c ofini -n "__fish_seen_subcommand_from ${n}" -l ${f.slice(2)}`);
    for (const g of groups) {
      const none = `__fish_seen_subcommand_from ${g}; and not __fish_seen_subcommand_from ${subs[g].join(" ")}`;
      for (const s of subs[g]) lines.push(`complete -c ofini -n "${none}" -a ${s} -d '${quote(commands[g].subcommands[s].summary)}'`);
      for (const s of subs[g]) for (const f of subFlags[`${g} ${s}`]) lines.push(`complete -c ofini -n "__fish_seen_subcommand_from ${g}; and __fish_seen_subcommand_from ${s}" -l ${f.slice(2)}`);
    }
    lines.push(`complete -c ofini -n "__fish_seen_subcommand_from new" -a '${NEW_KINDS.join(" ")}'`);
    lines.push(`complete -c ofini -n "__fish_seen_subcommand_from completion" -a 'bash zsh fish powershell'`);
    lines.push(`complete -c ofini -n "not __fish_use_subcommand" -F`);
    return `${lines.join("\n")}\n`;
  }
  if (shell === "powershell" || shell === "pwsh") {
    const table = [...names.map((n) => `    '${n}' = @(${per[n].map((f) => `'${f}'`).join(", ")})`), ...Object.entries(subFlags).map(([k, v]) => `    '${k}' = @(${v.map((f) => `'${f}'`).join(", ")})`)].join("\n");
    const groupTable = groups.map((g) => `    '${g}' = @(${subs[g].map((s) => `'${s}'`).join(", ")})`).join("\n");
    return `# ofini completion for PowerShell. Add to $PROFILE:  ofini completion powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName ofini -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $flags = @{
${table}
  }
  $groups = @{
${groupTable}
  }
  $words = @($commandAst.CommandElements | ForEach-Object { $_.ToString() })
  if ($words.Count -le 1 -or ($words.Count -eq 2 -and $wordToComplete)) {
    $flags.Keys | Where-Object { $_ -notlike '* *' } | Sort-Object | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
    return
  }
  $cmd = $words[1]
  if ($groups.ContainsKey($cmd)) {
    if ($words.Count -le 2 -or ($words.Count -eq 3 -and $wordToComplete)) { $groups[$cmd] | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }; return }
    $cmd = "$cmd $($words[2])"
  }
  if ($cmd -eq 'new' -and $words.Count -le 3) { @(${NEW_KINDS.map((k) => `'${k}'`).join(", ")}) | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }; return }
  if ($wordToComplete -like '-*' -and $flags.ContainsKey($cmd)) {
    $flags[$cmd] | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_) }
    return
  }
  Get-ChildItem -Path "$wordToComplete*" -ErrorAction SilentlyContinue | ForEach-Object { $p = if ($_.PSIsContainer) { "$($_.Name)/" } else { $_.Name }; [System.Management.Automation.CompletionResult]::new($p, $p, 'ProviderItem', $p) }
}
`;
  }
  return null;
}
