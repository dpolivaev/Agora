'use strict';

module.exports = function (appLogger) {
  return function (req, res) {
    res.status(404);
    res.render('errorPages/404.jade');
  };
};
