'use strict';
var _ = require('lodash');
var conf = require('simple-configure');
var async = require('async');

var beans = conf.get('beans');
var validation = beans.get('validation');
var groupstore = beans.get('groupstore');
var misc = beans.get('misc');

//Just checking if remote has been configured
var listAdapter = conf.get('fullyQualifiedHomeDir') ? beans.get('ezmlmAdapter') : beans.get('fakeListAdapter');

var isReserved = function (groupname) {
  return new RegExp('^edit$|^new$|^checkgroupname$|^submit$|^administration$|[^\\w-]', 'i').test(groupname);
};

var subscribedListsForUser = function (userMail, callback) {
  listAdapter.getSubscribedListsForUser(userMail, function (err, lists) {
    callback(err, _.without(lists, conf.get('adminListName')));
  });
};

var groupsForRetriever = function (retriever, callback) {
  async.waterfall([retriever],
    function (err, lists) {
      if (err) { return callback(err); }
      groupstore.groupsByLists(lists, callback);
    });
};

module.exports = {
  getSubscribedGroupsForUser: function (userMail, callback) {
    groupsForRetriever(function (callback) { subscribedListsForUser(userMail, callback); }, callback);
  },

  getAllAvailableGroups: function (callback) {
    groupsForRetriever(function (callback) { listAdapter.getAllAvailableLists(callback); }, callback);
  },

  allGroupColors: function (callback) {
    this.getAllAvailableGroups(function (err, groups) {
      callback(err, _.transform(groups, function (result, group) {
        result[group.id] = group.color;
      }, {}));
    });
  },

  getMailinglistUsersOfList: function (groupname, callback) {
    listAdapter.getUsersOfList(groupname, callback);
  },

  isGroupValid: function (group) {
    var self = this;
    var errors = validation.isValidGroup(group);
    groupstore.getGroup(group.id, function (err, existingGroup) {
      if (!existingGroup) {
        self.isGroupNameAvailable(group.id, function (err, result) {
          if (err) { errors.push('Technical error validating name of group.'); }
          if (!result) { errors.push('Dieser Gruppenname ist bereits vergeben.'); }
        });
        self.isEmailPrefixAvailable(group.emailPrefix, function (err, result) {
          if (err) { errors.push('Technical error validating email prefix.'); }
          if (!result) { errors.push('Dieses Präfix ist bereits vergeben.'); }
        });
      }
    });
    return errors;
  },

  createOrSaveGroup: function (newGroup, globalCallback) {
    groupstore.getGroup(newGroup.id, function (err, existingGroup) {
      async.parallel(
        [
          function (callback) {
            if (!existingGroup) {
              listAdapter.createList(newGroup.id, newGroup.emailPrefix, callback);
            } else {
              callback(null);
            }
          },
          function (callback) { groupstore.saveGroup(newGroup, callback); }
        ],
        function (err) { globalCallback(err, existingGroup); }
      );
    });
  },

  addUserToList: function (userMail, list, callback) {
    listAdapter.addUserToList(userMail, list, callback);
  },

  removeUserFromList: function (userMail, list, callback) {
    listAdapter.removeUserFromList(userMail, list, callback);
  },

  updateSubscriptions: function (userMail, oldUserMail, newSubscriptions, globalCallback) {
    async.waterfall(
      [
        function (callback) {
          subscribedListsForUser(oldUserMail, callback);
        }
      ],
      function (err, subscribedLists) {
        if (err) { return globalCallback(err); }
        newSubscriptions = misc.toArray(newSubscriptions);
        var emailChanged = userMail !== oldUserMail;
        var listsToSubscribe = emailChanged ? newSubscriptions : _.difference(newSubscriptions, subscribedLists);
        var listsToUnsubscribe = emailChanged ? subscribedLists : _.difference(subscribedLists, newSubscriptions);
        async.series(
          [
            function (funCallback) {
              var subscribe = function (list, callback) {
                listAdapter.addUserToList(userMail, list, callback);
              };
              async.each(listsToSubscribe, subscribe, funCallback);
            },
            function (funCallback) {
              var unsubscribe = function (list, callback) {
                listAdapter.removeUserFromList(oldUserMail, list, callback);
              };
              async.each(listsToUnsubscribe, unsubscribe, funCallback);
            }
          ],
          function (err) {
            globalCallback(err);
          }
        );
      }
    );
  },

  combineSubscribedAndAvailableGroups: function (subscribedGroups, availableGroups) {
    return availableGroups.map(function (group) {
      return {group: group, selected: _.some(subscribedGroups, {id: group.id})};
    });
  },

  isGroupNameAvailable: function (groupname, callback) {
    var trimmedGroupname = groupname.trim();
    if (isReserved(trimmedGroupname)) { return callback(null, false); }
    groupstore.getGroup(trimmedGroupname, function (err, group) {
      if (err) { return callback(err); }
      callback(null, group === null);
    });
  },

  isEmailPrefixAvailable: function (prefix, callback) {
    var trimmedPrefix = prefix.trim();
    groupstore.getGroupForPrefix(trimmedPrefix, function (err, group) {
      if (err) { return callback(err); }
      callback(null, group === null);
    });
  },

  getGroups: function (groupnames, callback) {
    groupstore.groupsByLists(misc.toArray(groupnames), callback);
  },

  isReserved: isReserved
};
