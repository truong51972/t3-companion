/** Portable project-scoped skill installer. Only the path is base64url-encoded
 * as inert argument data; no encoded JavaScript, eval, or shell interpolation. */
export const SKILL_PATH = '.agents/skills/t3-companion/SKILL.md' as const;

const SKILL_INSTALL_SCRIPT =
  "const cp=require('node:child_process'),fs=require('node:fs');" +
  "const marker=process.argv[1];try{" +
  "const project=Buffer.from(process.argv[2]||'','base64url').toString('utf8');" +
  "if(!project||!fs.statSync(project).isDirectory())throw Error('Not a project directory');" +
  "const win=process.platform==='win32';" +
  "const r=cp.spawnSync(win?'npx.cmd':'npx'," +
  "['-y','skills','add','truong51972/t3-companion','--skill','t3-companion','-y']," +
  "{cwd:project,encoding:'utf8',timeout:90000,windowsHide:true,shell:win});" +
  "if(r.error||r.status!==0)throw Error(r.error?.message||r.stderr||r.stdout||'Installer failed');" +
  "console.log('T3_COMPANION_RESULT:'+JSON.stringify({installed:true}));console.log(marker+':0')" +
  "}catch(e){const reason=String(e.message||e).replace(/[\\r\\n]+/g,' ').slice(-500);" +
  "console.log('T3_COMPANION_ERROR:'+reason);console.log(marker+':1');process.exitCode=1}";

function encodeProjectPath(project: string): string {
  const binary = Array.from(new TextEncoder().encode(project), byte => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function skillInstallShellCommand(project: string, marker: string): string {
  if (!/^COMPANION_[a-f0-9]{32}$/.test(marker)) throw new Error('Invalid command marker');
  if (!project) throw new Error('Project path required');
  return 'node -e "' + SKILL_INSTALL_SCRIPT + '" -- ' + marker + ' ' + encodeProjectPath(project);
}
