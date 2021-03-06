import { path, lazy_require, config, log, fsAsync } from 'azk';
import { async, promiseResolve, promiseReject } from 'azk/utils/promises';
import { UIProxy } from 'azk/cli/ui';
import { matchFirstRegex, matchAllRegex, fulltrim } from 'azk/utils/regex_helper';
import { printOutput } from 'azk/utils/spawn_helper';
import { GitCallError } from 'azk/utils/errors';

var lazy = lazy_require({
  semver: 'semver',
  git_helper: 'azk/utils/git_helper',
});

export class GetProject extends UIProxy {

  constructor(ui, args) {
    super(ui, args);
    this.IS_NEW_GIT_VERSION_AFTER = '1.7.10';
    this.is_new_git = null;
    this._gitHelper = lazy.git_helper;

    this._gitOutput = (data) => printOutput(
      this.ok.bind(this),
      args.verbose_level,
      '[git]',
      data);
  }

  static valid(url) {
    var isValid = /\//;
    return isValid.test(url);
  }

  static parseCommandOptions(opts) {
    var is_start      = opts.start;
    var system_name   = opts.system;
    var git_repo      = opts['git-repo'];
    var git_ref       = opts['git-ref'];
    var verbose_level = opts.verbose;

    if (!is_start) {
      // it's not azk start - continue 'azk scale'
      return null;
    }

    if (!system_name && !opts['git-repo']) {
      // nothing was passed - continue 'azk scale'
      return null;
    }

    if (system_name) {
      var valid_system_name = system_name.match(/^[a-zA-Z0-9-]+$/);
      if (!valid_system_name) {
        // invalid system name, must be a git repository link
        git_repo = system_name;
      } else {
        // must be a system name - continue 'azk scale'
        return null;
      }
    }

    // https://regex101.com/r/wG9dS2/1
    // parsing git_repo
    var match = matchFirstRegex(git_repo, /^(.*?)(#(.*))?$/g);
    git_repo = match[1];
    var git_repo_ref = match[3];
    if (!git_repo_ref && !git_ref) {
      git_ref = 'master';
    } else if (git_repo_ref && !git_ref) {
      git_ref = git_repo_ref;
    }

    // prepare URL
    // https://regex101.com/r/zG9mN5/2
    match = matchFirstRegex(git_repo, /^([\w-]+?)\/([\w-]+)$/g);
    if (match) {
      git_repo = `https://github.com/${match[1]}/${match[2]}.git`;
    }

    var git_dest_path = opts['dest-path'];
    if (!git_dest_path) {
      var url_lib   = require('url');
      var schema    = url_lib.parse(git_repo);
      git_dest_path = path.join("./", path.basename(schema.path).replace(/\.git/, ''));
    } else {
      if (git_dest_path[0] === "/") {
        git_dest_path = git_dest_path;
      } else {
        git_dest_path = "./" + git_dest_path;
      }
    }

    return {
      git_url               : git_repo,
      git_branch_tag_commit : git_ref,
      git_destination_path  : git_dest_path,
      verbose_level         : verbose_level
    };
  }

  startProject(command_parse_result) {
    return async(this, function* () {
      var force_azk_start_url_endpoint = config('urls:force:endpoints:start');
      this._sendForceAzkStart(command_parse_result, force_azk_start_url_endpoint);

      var git_version = yield this._gitHelper.version(this._gitOutput);
      this._checkGitVersion(git_version);

      var remoteInfo = yield this._getGitRemoteInfo(
        command_parse_result.git_url,
        command_parse_result.verbose_level);

      var branch_tag_name = command_parse_result.git_branch_tag_commit;
      var _isBranchOrTag  = this._isBranchOrTag(remoteInfo, branch_tag_name);

      // check if git_destination_path exists
      var dest_exists = yield this._checkDestinationFolder(command_parse_result.git_destination_path);

      // if exists, do a git pull inside
      if (dest_exists) {
        if (_isBranchOrTag) {
          this.warning('commands.start.get_project.dest_exists_branch', {
            git_url              : command_parse_result.git_url,
            git_branch_tag_commit: command_parse_result.git_branch_tag_commit,
            git_destination_path : command_parse_result.git_destination_path,
          });
        } else {
          this.warning('commands.start.get_project.dest_exists_commit', {
            git_url              : command_parse_result.git_url,
            git_branch_tag_commit: command_parse_result.git_branch_tag_commit,
            git_destination_path : command_parse_result.git_destination_path,
          });
        }
      } else {
        // clone to specific branch
        if (_isBranchOrTag && this.is_new_git) {
          yield this._cloneToFolder(
            command_parse_result.git_url,
            command_parse_result.git_branch_tag_commit,
            command_parse_result.git_destination_path,
            command_parse_result.verbose_level);
        } else {
          // clone to master
          yield this._cloneToFolder(
            command_parse_result.git_url,
            'master',
            command_parse_result.git_destination_path,
            command_parse_result.verbose_level);
          // checkout to specific commit
          yield this._checkoutToCommit(command_parse_result);
        }
      }
    });
  }

  _sendForceAzkStart(command_parse_result, path) {
    var request = require('request');
    var git_url = command_parse_result.git_url;
    var git_branch_tag_commit = command_parse_result.git_branch_tag_commit;

    var options = {
      method: 'post',
      url: path + '?repo=' + git_url,
      headers: {
        'User-Agent': 'azk'
      },
      json: true,
      body: JSON.stringify({
        repo: git_url,
        ref : git_branch_tag_commit,
      })
    };

    // call async - do not wait for response
    request(options, (error, response, body) => {
      var is_valid = response && (response.statusCode === 200 || response.statusCode === 201);
      if (error || !is_valid) {
        log.warn('[get project] Error on GetProject._sendForceAzkStart()');
        log.debug('[get project]', error, body);
      } else {
        log.info('[start][force]', { response_json: JSON.stringify(body) });
      }
    });
  }

  _checkGitVersion(git_version) {
    this.ok('commands.start.get_project.getting_git_version');
    this.is_new_git = lazy.semver.gte(git_version, this.IS_NEW_GIT_VERSION_AFTER);
    return git_version;
  }

  _getGitRemoteInfo(git_url) {
    return this._gitHelper.lsRemote(git_url, this._gitOutput)
    .then((lsRemote_result) => {
      this.ok('commands.start.get_project.getting_remote_info', {git_url});
      var parsed_result = this._parseGitLsRemoteResult(lsRemote_result);
      return parsed_result;
    })
    .catch(this._checkGitError(
      git_url,
      null,
      null));
  }

  _parseGitLsRemoteResult(git_result_message) {
    // https://regex101.com/r/pW4vY1/1
    var maches = matchAllRegex(git_result_message, /^(\w+?)\s(HEAD|refs\/heads\/(.*)|refs\/tags\/(.*))$/gm);
    return maches.map(function (match) {
      if (match[3]) {
        return {
          commit  : match[1],
          git_ref : match[3]
        };
      } else if (match[4]) {
        return {
          commit  : match[1],
          git_ref : match[4]
        };
      } else if (match[2] === 'HEAD') {
        return {
          commit  : match[1],
          git_ref : 'HEAD'
        };
      } else {
        return {
          commit  : match[1],
          git_ref : null
        };
      }
    });
  }

  _checkGitError(git_repo, git_branch_tag_commit, git_destination_path) {
    return function (err) {
      var original_error = err.message;
      var stack_trace = err.stack || '';
      var error_type;
      var throw_error = true;

      original_error = fulltrim(original_error);

      if (/pathspec ['"].+?['"] did not match any file/.test(err.message)) {
        // commit not found
        // https://regex101.com/r/bB2fZ9/1
        error_type = 'commit_not_exist';
      } else if (/Could not find remote branch/.test(err.message)) {
        // branch not found
        // https://regex101.com/r/bB2fZ9/2
        error_type = 'cloning_not_a_git_repo';
      } else if (/destination path ['"].+?['"] already exists and is not an empty directory/.test(err.message)) {
        // destination path exists
        // https://regex101.com/r/bB2fZ9/3
        error_type = 'folder_already_exists';
      } else if (/Repository not found/.test(err.message)) {
        // repo not found
        // https://regex101.com/r/bB2fZ9/4
        error_type = 'repo_not_found';
      } else if (/Could not resolve host/.test(err.message)) {
        error_type = 'not_resolve_host';
      } else if (/repository ['"].*?['"] not found/.test(err.message)) {
        error_type = 'repo_not_found';
      } else if (/could not create work tree dir/.test(err.message)) {
        error_type = 'cannot_create_folder';
      } else {
        error_type = 'git_error';
      }

      var gitCallError = new GitCallError(
          error_type,
          git_repo,
          git_branch_tag_commit,
          git_destination_path,
          original_error,
          stack_trace);

      if (throw_error) {
        return promiseReject(gitCallError);
      } else {
        return promiseResolve(gitCallError);
      }
    };
  }

  _isBranchOrTag(git_result_obj_array, branch_tag_name) {
    function _checkBranchOrTag(obj) {
      return obj.git_ref === branch_tag_name;
    }

    var filtered = git_result_obj_array.filter(_checkBranchOrTag);
    return filtered.length > 0;
  }

  _checkDestinationFolder(git_destination_path) {
    this.ok('commands.start.get_project.checking_destination', {
      git_destination_path,
    });

    return fsAsync.exists(git_destination_path);
  }

  _pullDestination(git_url, git_branch_tag_commit, git_destination_path) {
    this.ok('commands.start.get_project.git_pull', {
      git_url,
      git_branch_tag_commit,
      git_destination_path,
    });

    return this._gitHelper.pull(git_url,
                                git_branch_tag_commit,
                                git_destination_path,
                                this._gitOutput)
      .catch(this._checkGitError(git_url, git_branch_tag_commit, git_destination_path));
  }

  _cloneToFolder(git_url, git_branch_tag_commit, git_destination_path) {
    if (git_branch_tag_commit === 'master') {
      this.ok('commands.start.get_project.cloning_master_to_folder', {
        git_url,
        git_branch_tag_commit,
        git_destination_path,
      });
    } else {
      this.ok('commands.start.get_project.cloning_to_folder', {
        git_url,
        git_branch_tag_commit,
        git_destination_path,
      });
    }

    return this._gitHelper.clone(git_url,
                                git_branch_tag_commit,
                                git_destination_path,
                                this.is_new_git,
                                this._gitOutput)
      .catch(this._checkGitError(git_url, git_branch_tag_commit, git_destination_path));
  }

  _checkoutToCommit(parsed_args) {
    this.ok('commands.start.get_project.checkout_to_commit', parsed_args);

    return this._gitHelper.checkout(parsed_args.git_branch_tag_commit,
                                    parsed_args.git_destination_path,
                                    this._gitOutput)
    .catch(this._checkGitError(
      parsed_args.git_url,
      parsed_args.git_branch_tag_commit,
      parsed_args.git_destination_path));
  }
}
