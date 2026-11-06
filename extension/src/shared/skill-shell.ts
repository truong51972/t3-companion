/** Skill installation runs in terminal.open's selected project cwd.
 * No generated Base64 program and no project path interpolation into a shell. */
export const SKILL_PATH = '.agents/skills/t3-companion/SKILL.md' as const;

const SKILL_INSTALL_SCRIPT =
  "const cp=require('node:child_process');" +
  "const win=process.platform==='win32';" +
  "const r=cp.spawnSync(win?'npx.cmd':'npx'," +
  "['-y','skills','add','truong51972/t3-companion','--skill','t3-companion','-y']," +
  "{cwd:process.cwd(),encoding:'utf8',timeout:90000,windowsHide:true,shell:win});" +
  "if(r.error||r.status!==0){" +
  "const reason=String(r.error?.message||r.stderr||r.stdout||'Installer failed').replace(/[\\r\\n]+/g,' ').slice(-500);" +
  "console.log('T3_COMPANION_ERROR:'+reason);console.log(process.argv[1]+':1');process.exitCode=1" +
  "}else{console.log('T3_COMPANION_RESULT:'+JSON.stringify({installed:true}));console.log(process.argv[1]+':0')}";

export function skillInstallShellCommand(marker: string): string {
  if (!/^COMPANION_[a-f0-9]{32}$/.test(marker)) throw new Error('Invalid command marker');
  return 'node -e "' + SKILL_INSTALL_SCRIPT + '" -- ' + marker;
}
