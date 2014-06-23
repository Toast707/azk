"use strict";
var __moduleName = "src/system/index";
var $__1 = require('azk'),
    _ = $__1._,
    t = $__1.t,
    config = $__1.config;
var Image = require('azk/images').Image;
var System = function System(manifest, name, image) {
  var options = arguments[3] !== (void 0) ? arguments[3] : {};
  this.manifest = manifest;
  this.name = name;
  this.image = new Image(image);
  this.options = _.merge({}, this.default_options, options);
  this.options = this._expand_template(this.options);
};
($traceurRuntime.createClass)(System, {
  get default_options() {
    var msg = t("system.cmd_not_set", {system: this.name});
    return {
      command: ("echo \"" + msg + "\"; exit 1"),
      depends: []
    };
  },
  get command() {
    return this.options.command;
  },
  get depends() {
    return this.options.depends;
  },
  get row_mount_folders() {
    return this.options.mount_folders;
  },
  get namespace() {
    return this.manifest.namespace + '-sys.' + this.name;
  },
  filter: function(containers) {
    var regex = RegExp(("" + this.namespace));
    return _.filter(containers, (function(container) {
      return container.Names[0].match(regex);
    }));
  },
  _expand_template: function(options) {
    var data = {
      system: {
        name: this.name,
        persistent_folders: "/data"
      },
      manifest: {
        dir: this.manifest.manifestDirName,
        project_name: this.manifest.manifestDirName
      },
      azk: {
        default_domain: config('agent:balancer:host'),
        balancer_port: config('agent:balancer:port'),
        balancer_ip: config('agent:balancer:ip')
      }
    };
    return JSON.parse(_.template(JSON.stringify(options), data));
  }
}, {});
module.exports = {
  get System() {
    return System;
  },
  __esModule: true
};
//# sourceMappingURL=index.js.map