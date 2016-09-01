'use strict';

/* private */

const childproc = require('child_process');
const plist = require('simple-plist');
const which = require('which');
const fs = require('fs');

const useOpenSSL = true;

const cmd = {
  zip: '/usr/bin/zip',
  unzip: '/usr/bin/unzip',
  codesign: '/usr/bin/codesign',
  security: '/usr/bin/security',
  xcodebuild: '/usr/bin/xcodebuild',
  /* only when useOpenSSL is true */
  openssl: '/usr/local/bin/openssl'
};

function execProgram (bin, arg, opt, cb) {
  if (!opt) {
    opt = {};
  }
  opt.maxBuffer = 1024 * 1024;
  return childproc.execFile(bin, arg, opt, cb);
}

/* public */

function findInPath (cb) {
  const keys = Object.keys(cmd);
  let pending = keys.length;
  for (let key of keys) {
    which(key, function (err, loc) {
      if (err !== undefined) {
        cmd[key] = loc;
        if (--pending === 0) {
          cb(null, cmd);
        }
      }
    });
  }
}

function codesign (identity, entitlement, keychain, file, cb) {
  /* use the --no-strict to avoid the "resource envelope is obsolete" error */
  const args = [ '--no-strict' ]; // http://stackoverflow.com/a/26204757
  if (identity === undefined) {
    return cb(new Error('--identity is required to sign'));
  }
  args.push('-fs', identity);
  if (typeof entitlement === 'string') {
    args.push('--entitlements=' + entitlement);
  }
  if (typeof keychain === 'string') {
    args.push('--keychain=' + keychain);
  }
  args.push(file);
  execProgram(cmd.codesign, args, null, cb);
}

function verifyCodesign (file, keychain, cb) {
  const args = ['-v', '--no-strict'];
  if (typeof keychain === 'string') {
    args.push('--keychain=' + keychain);
  }
  args.push(file);
  execProgram(cmd.codesign, args, null, cb);
}

function getEntitlementsFromMobileProvision (file, cb) {
  if (useOpenSSL === true) {
    /* portable using openssl */
    const args = [ 'cms', '-in', file, '-inform', 'der', '-verify' ];
    execProgram(cmd.openssl, args, null, (error, stdout) => {
      cb(error, plist.parse(stdout)['Entitlements']);
    });
  } else {
    /* OSX specific using security */
    const args = [ 'cms', '-D', '-i', file ];
    execProgram(cmd.security, args, null, (error, stdout) => {
      cb(error, plist.parse(stdout)['Entitlements']);
    });
  }
}

function zip (cwd, ofile, src, cb) {
  fs.unlink(ofile, () => {
    const args = [ '-qry', ofile, src ];
    execProgram(cmd.zip, args, { cwd: cwd }, cb);
  });
}

function unzip (ifile, odir, cb) {
  const args = [ '-o', ifile, '-d', odir ];
  execProgram(cmd.unzip, args, null, cb);
}

function xcaToIpa (ifile, odir, cb) {
  const args = [ '-exportArchive', '-exportFormat', 'ipa', '-archivePath', ifile, '-exportPath', odir ];
  execProgram(cmd.xcodebuild, args, null, cb);
}

function getIdentities (cb) {
  const args = [ 'find-identity', '-v', '-p', 'codesigning' ];
  execProgram(cmd.security, args, null, (error, stdout) => {
    if (error) {
      return cb(error);
    }
    const lines = stdout.split('\n');
    lines.pop(); // remove last line
    let ids = [];
    lines.forEach((line) => {
      const tok = line.indexOf(') ');
      if (tok !== -1) {
        const msg = line.substring(tok + 2).trim();
        const tok2 = msg.indexOf(' ');
        if (tok2 !== -1) {
          ids.push({
            'hash': msg.substring(0, tok2),
            'name': msg.substring(tok2 + 1)
          });
        }
      }
    });
    cb(undefined, ids);
  });
}

[ findInPath,
  codesign,
  verifyCodesign,
  getEntitlementsFromMobileProvision,
  zip,
  unzip,
  xcaToIpa,
  getIdentities
].forEach(function (x) {
  module.exports[x.name] = x;
});
