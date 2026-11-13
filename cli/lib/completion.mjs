// Shell completion scripts for `ofini completion <shell>`: commands, their options and kinds for `ofini new`; files are
// completed by the shell itself.
import { GLOBAL_FLAGS } from "./args.mjs";
import { NEW_KINDS } from "./project.mjs";

const flagsOf = (cmd) => [...Object.keys(cmd.flags), ...Object.keys(GLOBAL_FLAGS)].map((f) => `--${f}`);

export function completionScript(shell, commands) {
  const names = Object.keys(commands);
  const per = Object.fromEntries(names.map((n) => [n, flagsOf(commands[n])]));
  if (shell === "bash") {
    const cases = names.map((n) => `    ${n}) opts="${per[n].join(" ")}" ;;`).join("\n");
    return `# ofini completion for bash. Add to ~/.bashrc:  eval "$(ofini completion bash)"
_ofini() {
  local cur=\${COMP_WORDS[COMP_CWORD]} cmd=\${COMP_WORDS[1]} opts=""
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${names.join(" ")}" -- "$cur") ); return
  fi
  case "$cmd" in
${cases}
  esac
  if [ "$cmd" = "new" ] && [ "$COMP_CWORD" -eq 2 ]; then COMPREPLY=( $(compgen -W "${NEW_KINDS.join(" ")}" -- "$cur") ); return; fi
  if [ "$cmd" = "completion" ]; then COMPREPLY=( $(compgen -W "bash zsh fish powershell" -- "$cur") ); return; fi
  if [[ "$cur" == -* ]]; then COMPREPLY=( $(compgen -W "$opts" -- "$cur") ); else COMPREPLY=( $(compgen -f -- "$cur") ); fi
}
complete -o filenames -F _ofini ofini
`;
  }
  if (shell === "zsh") {
    const cmds = names.map((n) => `'${n}:${commands[n].summary.replace(/'/g, "")}'`).join(" ");
    const cases = names.map((n) => `    ${n}) _arguments '*:file:_files' ${per[n].map((f) => `'${f}'`).join(" ")} ;;`).join("\n");
    return `#compdef ofini
# ofini completion for zsh. Add to ~/.zshrc:  eval "$(ofini completion zsh)"
_ofini() {
  if (( CURRENT == 2 )); then
    local -a cmds; cmds=(${cmds}); _describe 'command' cmds; return
  fi
  if [[ $words[2] == new && CURRENT == 3 ]]; then compadd ${NEW_KINDS.join(" ")}; return; fi
  if [[ $words[2] == completion ]]; then compadd bash zsh fish powershell; return; fi
  case $words[2] in
${cases}
  esac
}
compdef _ofini ofini
`;
  }
  if (shell === "fish") {
    const lines = [`# ofini completion for fish:  ofini completion fish > ~/.config/fish/completions/ofini.fish`, "complete -c ofini -f"];
    for (const n of names) lines.push(`complete -c ofini -n "__fish_use_subcommand" -a ${n} -d '${commands[n].summary.replace(/'/g, "")}'`);
    for (const n of names) for (const f of per[n]) lines.push(`complete -c ofini -n "__fish_seen_subcommand_from ${n}" -l ${f.slice(2)}`);
    lines.push(`complete -c ofini -n "__fish_seen_subcommand_from new" -a '${NEW_KINDS.join(" ")}'`);
    lines.push(`complete -c ofini -n "__fish_seen_subcommand_from completion" -a 'bash zsh fish powershell'`);
    lines.push(`complete -c ofini -n "not __fish_use_subcommand" -F`);
    return `${lines.join("\n")}\n`;
  }
  if (shell === "powershell" || shell === "pwsh") {
    const table = names.map((n) => `    '${n}' = @(${per[n].map((f) => `'${f}'`).join(", ")})`).join("\n");
    return `# ofini completion for PowerShell. Add to $PROFILE:  ofini completion powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName ofini -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $flags = @{
${table}
  }
  $words = @($commandAst.CommandElements | ForEach-Object { $_.ToString() })
  if ($words.Count -le 1 -or ($words.Count -eq 2 -and $wordToComplete)) {
    $flags.Keys | Sort-Object | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
    return
  }
  $cmd = $words[1]
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
