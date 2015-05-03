'use strict';

console.log('background page started');
var MaxWindowSize = 4;

// console.log(Promise.props);

function guid() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
    s4() + '-' + s4() + s4() + s4();
}
//
// var MaxClusterNum = 4;
// var MinClusterNum = 2;

var Arranger = function () {
  
  var getTabName = function (tab) {
    return (new URL(tab.url)).hostname;
  };

  var getItemId = function (item) {
    return item.id;
  };

  this.run = function (windows, tabs, focus, maxWin) {
    
    var orderedNames = Object.keys(tabs);
    var usedWinIds = {};
    var focusName = getTabName(focus);
    var focusIdx = orderedNames.indexOf(focusName);
    var createdWindows = {};
    
    console.log('env: %s windows = %s, tabs categorized in %s themes, focus.id = %s, maxWin = %s', windows.length, windows.map(getItemId), orderedNames.length, focusIdx, maxWin);
    
    var findUsableWindowId = function () {
      var i = windows.length, winIdx;
      while(i--) {
        winIdx = windows[i].id;
        if(winIdx !== focus.windowId && !(winIdx in usedWinIds)) {
          return winIdx;
        }
      }
      //no usable window in existing windows
      return '@new-' + guid();
    };
    
    var getWindow = function (id) {
      var idx = windows.map(getItemId).indexOf(id);
      if(idx > -1) {
        return windows[idx];
      }
      return createdWindows[id];
    };
    
    var moveTabsToWindow = function (moved, windowId) {
      var win = getWindow(windowId);
      if(win) {
        return new Promise(function (resolve) {
          chrome.tabs.move(moved.map(getItemId), {
            windowId: win.id,
            index: -1
          }, resolve);
        });
      }
      return new Promise(function (resolve) {
        chrome.windows.create({
          tabId: getItemId(moved[0])
        }, function (window) {
          windows.push(window);
          usedWinIds[window.id] = usedWinIds[windowId];
          createdWindows[windowId] = window;
          delete usedWinIds[windowId];
          console.log('window %s is created as %s', windowId, window.id);
          if(moved.length > 1) {
            chrome.tabs.move(moved.slice(1).map(getItemId), {
              windowId: window.id,
              index: -1
            }, resolve);
          } else {
            resolve();
          }
        });
      });
      
      
    };
    
    //layout windows
    orderedNames.forEach(function (name, i) {
      var winId;
      if(i < maxWin - 1) {
        if(name === focusName) {
          winId = focus.windowId;
        } else {
          winId = findUsableWindowId();
        }
        usedWinIds[winId] = name;
      }
    });
    if(focusIdx > maxWin - 2) {
      usedWinIds[focus.windowId] = orderedNames.slice(maxWin - 1);
    } else {
      usedWinIds[findUsableWindowId()] = orderedNames.slice(maxWin - 1);
    }

    
    var ids = Object.keys(usedWinIds).map(function (id) {
      var parsed = parseInt(id, 10);
      if(parsed) {
        return parsed;
      }
      return id;
    });
    
    return Promise.each(ids, function (winId) {
      var name;
      if(typeof usedWinIds[winId] === 'string') {//move background tabs
        name = usedWinIds[winId];
        console.log('Move %s tabs to window %s for theme %s', tabs[name].length, winId, name);
        return (moveTabsToWindow(tabs[name], winId));
      } else {
        //move tabs in the same window of focused tab
        usedWinIds[winId].forEach(function (name) {
          var idx, moved;
          if(name === focusName) {
            idx = tabs[name].map(getItemId).indexOf(getItemId(focus));
            moved = tabs[name].splice(idx, 1);
          } else {
            moved = tabs[name];
          }
          console.log('Move %s tabs from %s to theme-less context at window %s', tabs[name].length, tabs[name].map(function(t) {return t.windowId; }).join(','), winId);
          return (moveTabsToWindow(moved, winId));
        });
      }
    });
    
  };
  
  return this;
}.call({});


var Candidates = function () {
  
  this.data = {};
  
  this.count = function (tab) {
    var url = new URL(tab.url);
    if(!url.host) {
      console.warn('invalid tab', tab);
      return;
    }
    var name = url.host;
    if(this.data[name]) {
      this.data[name].push(tab);
    } else {
      this.data[name] = [tab];
    }
  };
  
  this.elect = function () {
    var k, tmp = [];
    for(k in this.data) {
      if(this.data.hasOwnProperty(k)) {
        tmp.push([this.data[k].length, k]);
      }
    }
    var self = this;
    return tmp.sort(function (a, b) {
      return b[0] - a[0];
    }).reduce(function (prev, cur) {
      prev[cur[1]] = self.data[cur[1]];
      return prev;
    }, {});
  };
  
  this.determinClusterSize = function () {
    var counts = Object.keys(this.data).map(function (k) {
      return this.data[k].length;
    }, this).sort().reverse();
    var total = counts.reduce(function (p, c) {
      return p + c;
    });
    var i, len, r = 0;
    for(i = 0, len = counts.length; i < len; i++) {
      r += counts[i];
      if(r / total > 0.8) {
        return Math.min(i + 1, MaxWindowSize);
      }
    }
    return 2;//default value
  };
  
  return this;
  
}.call({});


chrome.browserAction.onClicked.addListener(function(tab) {
  chrome.windows.getAll({
    populate: true
  }, function (windows) {
    windows.forEach(function(win) {
      win.tabs.forEach(function (t) {
        Candidates.count(t);
      });
    });
    Arranger.run(windows, Candidates.elect(), tab, Candidates.determinClusterSize()).catch(function (e) {
      console.log(e.stack);
    });
    
  });
});