var path = require('path'),
    fs = require('fs'),
    q = require('q'),
    child_process = require('child_process'),
    temp = require('temp'),
    colors = require('colors'),
    _ = require('underscore'),
    html = require("html"),
    Ralio = require('./ralio'),
    config = {},
    ralio = {};
var promise = require("promisejs");
function RJI(config_data) {
  config = config_data;
  ralio = new Ralio(config.hostname, config.username, config.password, config.version,
    config.project, config.team);
}

RJI.prototype.backlog =  function (json_data, callback) {
  var options = json_data;
  var self = this, 
      team = config.team,
      project = options.project || config.project,
      projectName = project || team,
      opts = {
        projectName: project || team,
        pagesize: options.all ? 100 : 20,
        tag: options.tag
      };
      var story_data = [];
      ralio.backlog(opts, function (error, stories) {
        if(error){
          console.log("error occurred");
          return({'error': error});
        }
        if (!options.all) {
          stories = stories.slice(0, 20);
        }
        stories.forEach(function (story) {
          story_data.push(self.getStoryData(story, {state: false, tags: true}));
        });
        callback ({"stories" : story_data});
      });
}

RJI.prototype.sprint = function (options) {
  var self = this,
      team = options.group || this.config.team,
      project = options.project || this.config.project,
      projectName = project || team;
  this.ralio.sprint(projectName, options, function (error, stories) {
    self.errors(error);
    stories.forEach(function (story) {
      if (story.ScheduleState != 'Accepted' || options.accepted) {
        var tasks = _.extend(story.Tasks, story.Defects)
        if(tasks.length > 0){
          self.printStoryLine(story, {owners: !options.tasks});
          if (options.tasks) {
            tasks.forEach(function (task) {
              self.printTaskLine(task);
            });
          }
        } else {
          self.printTaskLine(story, {tab: false, points: true});
        }
      }
    });
    self.saveQuickIDs();
  });
};

RJI.prototype.current = function () {
  var self = this;
  this.ralio.current(this.config.team, function (error, stories) {
    self.errors(error);
    stories.forEach(function (story) {
      self.printStoryLine(story, {owners: true});
      story.Tasks.forEach(function (task) {
        self.printTaskLine(task);
      });
    });
    self.saveQuickIDs();
  });
};

RJI.prototype.me = function () {
  var self = this;
  this.ralio.me(this.config.team, function (error, stories) {
    if(error !== null) {
      self.errors(error);
    } else {
      stories.forEach(function (story) {
        self.printStoryLine(story);
        story.Tasks.forEach(function (task) {
          self.printTaskLine(task);
        });
      });
     self.saveQuickIDs();
    }
  });
};

RJI.prototype.preFormatHtml = function(html_in) {
  var formatted = html.prettyPrint(html_in, {indent_size: 2});
  return formatted;
};

RJI.prototype.ATTRIBUTE_OPTIONS = {
  supported: [
    {type: "STRING", suffix: '.txt'},
    {type: "BOOLEAN", suffix: '.txt'},
    {type: "INTEGER", suffix: '.txt'},
    {type: "TEXT", suffix: '.html', preformat: RJI.prototype.preFormatHtml}
    ],

  forType: function (type) {
    return _.find(this.supported, function(ok_type){return ok_type.type == type});
  }
};

RJI.prototype.edit = function (formattedID, field) {
  var self = this;

  this.ralio.artifact(formattedID, {fetch: field}, {typeDefinition: true}, function (err, artifact) {
    self.errors(err);

    if (typeof artifact[field] === 'undefined') {
      return self.errors('Field ' + field + ' not found.');
    }

    var fieldType = _.find(artifact._typeDefinition.Attributes, function(attr){
      return attr.ElementName == field 
    }).AttributeType;

    var fieldOpts = self.ATTRIBUTE_OPTIONS.forType(fieldType);
    if (typeof fieldOpts === 'undefined') {
      return self.errors('Field ' + field + ' is not a type suported by this tool. [' + fieldType + ']');
    }

    var suffix = fieldOpts.suffix || '.txt',
        old_value = artifact[field];

    if (typeof fieldOpts.preformat === 'function') {
      old_value = fieldOpts.preformat(old_value);
    }

    self.ralio.editor(old_value, {suffix: suffix}, function (result) {
      if (false === result.success) {
        return self.errors('EDITOR returned error.  Exit code: ' +  result.editor.exit_code + ', Exit signal: ' + result.editor.exit_signal);
      }

      if (old_value !== result.value) {
        var updates = {};
        updates[field] = result.value;
        
        self.ralio.updateArtifact(artifact, updates, function (err) {
          if (err !== null){
            return self.errors('Error updating ' + formattedID + '.  Err: ' + err);
          } else {
            console.log(formattedID.yellow + ' ' + old_value.grey + ' ▶ ' + result.value.green);
          }
        });
      }
    });
  });
};

RJI.prototype.show = function (story) {
  var self = this;
  this.ralio.story(this.fetchID(story), function (error, story) {
    self.errors(error);
    if (story === null) {
      return self.errors('No story found :(');
    } else {

      var descTempPath = temp.path({suffix: '.html'});
      fs.writeFileSync(descTempPath, story.Description);
      child_process.exec('elinks -dump ' + descTempPath, function (err, stdout, stderr) {
        
        if (err) {
          var description =
            '  There was an error formatting the description text :(\n'.red +
            '  Is elinks installed?  (hint: brew install elinks or sudo apt-get install elinks).'.red;
        } else {
          var description = stdout.replace(/^\n+/, '').replace(/\n+$/g, '');
        }

        fs.unlinkSync(descTempPath);

        (story.Tasks.length > 0) ? 
          self.printStoryLine(story) : self.printTaskLine(story, {tab: false, points: true});

        if (description != '') {
          console.log('\n' + description + '\n');
        }

        story.Tasks.forEach(function (task) {
          self.printTaskLine(task);
        });

        self.saveQuickIDs();
      });
    }
  });
};

RJI.prototype.open = function (story) {
  var self = this,
      openCommand = process.platform === "linux" ? "xdg-open" : "open"
  this.ralio.story(this.fetchID(story), function (error, story) {
    self.errors(error ? error.red : error);
    if (story === null) {
      return self.errors('No story found :(');
    } else {
      var story_type = null;
      switch (story._type) {
        case 'Defect': story_type = 'defect'; break;
        case 'HierarchicalRequirement': story_type = 'userstory'; break;
        case 'Task': story_type = 'task'; break;
      }
      child_process.exec(
        openCommand + ' ' +
        self.hostname + '#/' +       
        story.Project.ObjectID +
        'd/detail/' + story_type +
        '/' + story.ObjectID);
    }
  });
};

RJI.prototype.start = function (task, options) {
  var self = this,
      update_options = {state: 'In-Progress', own: true, blocked: false, pair: options.pair};

  this.ralio.setTaskState(this.fetchID(task), update_options, function (error, task) {
    self.errors(error);
    self.printTaskLine(task, {quickid: false});
  });
};

RJI.prototype.finish = function (task, options) {
  var self = this,
      update_options = {state: 'Completed', own: true, blocked: false, pair: options.pair};

  if (options.rootcause)
    update_options = _.extend(update_options, {rootcause: options.rootcause})
  if (options.resolution)
    update_options = _.extend(update_options, {resolution: options.resolution});

  this.ralio.setTaskState(this.fetchID(task), update_options, function (error, task) {
    self.errors(error);
    self.printTaskLine(task, {quickid: false});
  });
};

RJI.prototype.discuss = function (option, item, message, options) {
  var self = this,
      deferred = q.defer();

  if (option == 'add') {
    this.ralio.addComment(this.fetchID(item), message, function(error, data) {
      self.errors(error);
      if (typeof data.PostNumber === "undefined") {
        deferred.reject();
      } else {
        deferred.resolve();
      }
    });
  } else if (option == 'show') {
    deferred.resolve();
  } else {
    return self.errors('Option to discuss command must be one of: show, add.');
  }

  deferred.promise.then(function() {
    self.ralio.comments(self.fetchID(item), function (error, comments) {
      self.errors(error);
      self.printTaskLine(comments.artifact, {quickid: false, tab: false});

      for (var i in comments.comments) {
        self.printDiscussionLine(comments.comments[i]);
      }

      if (comments.comments.length === 0) {
        return self.errors('There is no discussion going on here :-)');
      }
    });
  });
}

RJI.prototype.abandon = function (task) {
  var self = this;
  this.ralio.setTaskState(this.fetchID(task), {state: 'Defined', own: false, blocked: false, pair: ""}, function (error, task) {
    self.errors(error);
    self.printTaskLine(task, {quickid: false});
  });
};

RJI.prototype.block = function (task) {
  var self = this;
  this.ralio.setTaskState(this.fetchID(task), {blocked: true}, function (error, task) {
    self.errors(error);
    self.printTaskLine(task, {quickid: false});
  });
};

RJI.prototype.unblock = function (task) {
  var self = this;
  this.ralio.setTaskState(this.fetchID(task), {blocked: false}, function (error, task) {
    self.errors(error);
    self.printTaskLine(task, {quickid: false});
  });
};

RJI.prototype.point = function (story, points) {
  var self = this;
  this.ralio.point(this.fetchID(story), points, function (error, story) {
    self.errors(error);
    self.printStoryLine(story, {quickid: false});
  });
};

RJI.prototype.time = function (task, hours) {
    var self = this;
    this.ralio.time(this.fetchID(task), hours, function(error, data) {
        self.errors(error);
        if (data.Hours) {
          console.log("Task " + task.yellow + " timesheet entry is now " + data.Hours.toString().yellow + " hours.");
        } else {
          console.log(data);
        }
    });
}

RJI.prototype.task = function (option, story, opts) {
  var self = this,
      team = self.config.team,
      project = opts.project || self.config.project,
      projectName = project || team,
      tags = opts.tags ? opts.tags.split(',') : [];

  this.ralio.task(option, projectName, this.fetchID(story), opts.name, tags, function (error, option, story, taskname) {
    self.errors(error);
    self.printStoryLine(story, {quickid: false});
  });
};

RJI.prototype.errors = function (error) {
  if (error !== null) {
    error = typeof error === "object" ? error.message : error
    console.log(error.red);
    process.exit(1);
  }
};

RJI.prototype.isInProgress = function(artifact){
  return (artifact.State == "In-Progress" || artifact.ScheduleState === "In-Progress");
};

RJI.prototype.getStoryData = function (story, options) {
  var defaults = {state: true, owners: false, tags: true, quickid: true};
  options = _.extend({}, defaults, options || {});
  var fields = {};
  fields["FormattedID"] = story.FormattedID;
  fields["PlanEstimate"] = story.PlanEstimate;
  if (options.state) {
    var state = STATES[story.ScheduleState];
    if (typeof state === "string") {
      fields["Blocked"] = story.Blocked;
    }
  }
  fields["Name"] = story.Name;
  if (options.owners) {
    var owners = [], RJI = this;
    var tasksActive = false; // if no tasks active then print story owner only
    if (story.Tasks.length > 0) {
      story.Tasks.forEach(function (task) {
        if (RJI.isInProgress(task) && task.Owner !== null) {
          tasksActive = true;
          owners.push(task.Owner._refObjectName);
        }
        });
        if (!tasksActive) {
          owners.push(story.Owner._refObjectName);
        }
      } else {
        owners.push(story.Owner._refObjectName);
      }
    }
    fields["Owners"] = _.compact(owners).join(', ');
  
  if (options.tags) {
    fields["tags"]  = _.compact(story.Tags).join(',');
  }
  return fields;
};

RJI.prototype.printTaskLine = function (task, options) {
  var defaults = {quickid: true, tab: true, tags: true, points: false};
  options = _.extend({}, defaults, options || {});
  
  var taskState = TASKSTATES[task.ScheduleState || task.State] || '.',
      owner = task.Owner !== null ? "❙ " + task.Owner._refObjectName : '',
      fields = [],
      pair = (task.Pair && task.Pair !== "" && task.Pair !== "true" && task.Pair !== null) ? "& " + task.Pair : null;

  if (options.quickid)
    fields.push(this.quickID(task));
  
  if (options.tab)
    fields.push(' ');

  fields.push(task.FormattedID.yellow);
  if (options.points)
    fields.push((task.PlanEstimate || '-').toString().blue);

  fields.push(task.Blocked ? taskState.red : taskState.green);
  fields.push(task.Name);
  
  fields.push(this.isInProgress(task) ? owner.blue : owner);  
  
  if (pair) {
    fields.push(this.isInProgress(task) ? pair.blue : pair);
  }

  if (options.tags) {
    var tags = _.map(_.compact(task.Tags), function (t) { return t.Name }).join(', ');
    fields.push(this.isInProgress(task) ? tags.magenta : tags.grey);
  }

  console.log(fields.join(' '));
};

RJI.prototype.printDiscussionLine = function (comment, options) {
  var defaults = {number: true, tab: true};
  options = _.extend({}, defaults, options || {});

  var owner = comment.User !== null ? comment.User._refObjectName + " ❙" : '',
      post = '' + (comment.PostNumber + 1),
      fields = [];

  if (options.tab)
    fields.push(' ');

  if (options.number)
    fields.push(post.yellow);

  fields.push(owner.blue);
  fields.push(comment.Text);

  console.log(fields.join(' '));
};

RJI.prototype.quickID = function (task_or_story) {
  if (this.task_ids === undefined) {
    this.task_ids = [];
  }
  this.task_ids.push(task_or_story.FormattedID);
  return this.rpad(this.task_ids.length, 3);
};

RJI.prototype.rpad = function (num, cols) {
  var ret = num.toString();
  while (ret.length < cols) {
    ret = ' ' + ret;
  }
  return ret;
};

RJI.prototype.saveQuickIDs = function () {
  if(this.task_ids !== undefined) {
    fs.writeFileSync(
      path.join(process.env.HOME, '.ralio_recent'),
      JSON.stringify(this.task_ids)
    );
  }
};

RJI.prototype.fetchID = function (id) {
  if (id.match(/^\d+$/)) {
    var quick_idx = parseInt(id, 10);
    if (this.quickIDs !== undefined && quick_idx <= this.quickIDs.length) {
      return this.quickIDs[quick_idx - 1];
    }
    else {
      console.error(('No quick ID ' + id + ' found').red);
      process.exit(1);
    }
  }
  return id;
}

var STATES = {
  "Suggestion": "?",
  "Defined": "·",
  "Submitted": "·",
  "In-Progress": "▸",
  "Completed": "✔",
  "Fixed": "✔",
  "Closed": "✔",
  "Accepted": "✩",
  "Released": "✮",
  "Grooming": "⌚"
};

var TASKSTATES = _.extend(STATES, {
  "Submitted": "·",
  "Defined": "·",
  "Open": "·",
  "In-Progress": "▸",
  "Completed": "✔",
  "Fixed": "✔",
  "Closed": "✔",
});

module.exports = RJI;
