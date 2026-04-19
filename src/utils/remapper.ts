import type { Platform, KeyDefines } from '../libs/keycodes.js';

function remapper(
  from: 'standard' | Platform,
  to: 'standard' | Platform,
  defines: KeyDefines,
): KeyDefines {
  if (from === 'standard') {
    switch (to) {
      case 'linux':
        break;
      case 'darwin':
        defines['91'] = defines['3639'];
        defines['92'] = defines['70'];
        defines['93'] = defines['3653'];
        defines['91'] = defines['57416'];
        defines['56'] = defines['3675'];
        defines['3675'] = defines['56'];
        defines['3675'] = defines['3640'];
        defines['56'] = defines['3676'];
        defines['29'] = defines['3613'];
        defines['3597'] = defines['69'];
        break;
      case 'win32':
        defines['61010'] = defines['3666'];
        defines['60999'] = defines['3655'];
        defines['61001'] = defines['3657'];
        defines['61011'] = defines['3667'];
        defines['61007'] = defines['3663'];
        defines['61009'] = defines['3665'];
        defines['3677'] = defines['3613'];
        defines['61000'] = defines['57416'];
        defines['61003'] = defines['57419'];
        defines['61008'] = defines['57424'];
        defines['61005'] = defines['57421'];
        break;
    }
  } else {
    switch (from) {
      case 'darwin':
        defines['3639'] = defines['91'];
        defines['70'] = defines['92'];
        defines['3653'] = defines['93'];
        defines['3675'] = defines['56'];
        defines['56'] = defines['3675'];
        defines['3640'] = defines['3675'];
        defines['3676'] = defines['56'];
        defines['3613'] = defines['29'];
        break;
      case 'win32':
        defines['3666'] = defines['61010'];
        defines['3655'] = defines['60999'];
        defines['3657'] = defines['61001'];
        defines['3667'] = defines['61011'];
        defines['3663'] = defines['61007'];
        defines['3665'] = defines['61009'];
        defines['57416'] = defines['61000'];
        defines['57419'] = defines['61003'];
        defines['57424'] = defines['61008'];
        defines['57421'] = defines['61005'];
        break;
      case 'linux':
        break;
    }
  }
  return defines;
}

export default remapper;
