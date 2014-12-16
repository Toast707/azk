import { log, _, async, config, t, lazy_require } from 'azk';
import { Command, Helpers } from 'azk/cli/command';
import { SYSTEMS_CODE_ERROR, NotBeenImplementedError } from 'azk/utils/errors';
import { Cmd as ScaleCmd } from 'azk/cmds/scale';

var open = require('open');

lazy_require(this, {
  Manifest: ['azk/manifest'],
});

var action_opts = {
  start: { instances: {}, key: "already" },
  stop:  { instances: 0 , key: "not_running" },
};

class Cmd extends ScaleCmd {
  _scale(systems, action, opts) {
    var scale_options = action_opts[action];

    opts = _.defaults(opts, {
      instances: {},
    });

    return async(this, function* () {
      var system, result = 0;
      systems = _.clone(systems);

      while(system = systems.shift()) {
        var ns = ["commands", action];

        if (action == "start") {
          // The number of instances is not set to system.name use "{}"
          var instances = _.defaults(opts.instances[system.name], _.clone(scale_options.instances));
        } else {
          var instances =_.clone(scale_options.instances);
        };

        // Force start scalable = { default: 0 }
        // Only if specified
        if (!(opts.systems) && action == "start" && _.isObject(scale_options.instances)) {
          if (system.scalable.default == 0 && !system.disabled) {
            instances = 1;
          }
        }

        this.verbose([...ns, "verbose"], system);
        var icc = yield super(system, instances, opts);

        if (icc == 0) {
          this.fail([...ns, scale_options.key], system);
          result = SYSTEMS_CODE_ERROR;
        }
      };

      return result;
    });
  }

  start(manifest, systems, opts) {
    return async(this, function* () {
      var result = yield this._scale(systems, 'start', opts);

      // if flag --open
      if (!_.isUndefined(opts.open)) {
        var open_with,
            system = manifest.systemDefault;

        if (_.isNull(opts.open) || !_.isString(opts.open) ) {
          open_with = null;
        } else {
          open_with = opts.open;
        }

        if (system.balanceable) {
          var instances = yield system.instances({ type: "daemon" });

          if (instances.length > 0) {
            open(system.url, open_with);
          } else {
            this.warning('commands.start.option_errors.open.system_not_running', { name : system.name });
          }

        } else {
          this.warning('commands.start.option_errors.open.default_system_not_balanceable', { name : system.name });
        }
      };
    })
    .fail((error) => {
      this.fail(error);
      this.fail('commands.start.fail', error);
      return this
        .stop(manifest, systems, opts)
        .then(() => { return error.code ? error.code : 127 });
    });
  }

  stop(manifest, systems, opts) {
    systems = systems.reverse();
    return this._scale(systems, 'stop', opts);
  }

  reload(manifest, systems, opts) {
    this.fail('commands.reload.deprecation');
    return this.restart(manifest, systems, opts);
  }

  restart(manifest, systems, opts) {
    return async(this, function* () {
      var scale_options = _.merge({
        instances: {}
      }, opts);

      // save instances count
      for (var system of systems) {
        var instances = yield system.instances({ type: "daemon" });
        scale_options.instances[system.name] = instances.length;
      }

      yield this.stop(manifest, systems, opts);
      yield this.start(manifest, systems, scale_options);
    });
  }
}

export function init(cli) {
  var cmds = {
    start   : (new Cmd('start [system]'   , cli))
                .addOption(['--reprovision', '-R'], { default: false })
                .addOption(['--open', '-o'], { type: String, placeholder: "application" }),
    stop    : (new Cmd('stop [system]'    , cli))
                .addOption(['--remove', '-r'], { default: true }),
    restart : (new Cmd('restart [system]' , cli))
                .addOption(['--reprovision', '-R'], { default: false })
                .addOption(['--open', '-o'], { type: String, placeholder: "application" }),
    reload  : (new Cmd('reload [system]'  , cli))
                .addOption(['--reprovision', '-R'], { default: true }),
  }

  return cmds;
}
