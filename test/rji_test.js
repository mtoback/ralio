var RJI = require('../lib/rji');
var config_data = {"username": "2015@hackathon.com", "password":"hackathon2015", "hostname" :"https://demo-west.rallydev.com", "version": "1.43", 
"project":"API Team", "team":"API Team"}
var backlog_opts = {"all": true, "tag": ['MT']};
var rji_ready = new RJI(config_data);
function getBacklog(backlog_opts){
    rji_ready.backlog(backlog_opts, function(res){
            console.log(res);
    });
}
getBacklog(backlog_opts);


