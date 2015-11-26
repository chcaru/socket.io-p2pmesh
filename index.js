
var delaunay = require('delaunay-fast');
var crypto = require('crypto');

function P2PMesh(io, opts, log) {

    this.io = io.of('/mesh');
    this.log = log;

    this.locator = (opts && opts.locator) || function() {
        return [Math.random() * 1000, Math.random() * 1000];
    };

    this.timeout = (opts && opts.timeout) || 5000;

    this.sockets = {};

    this.verts = [];
    this.graph = [];

    this.chain = Promise.resolve();

    var self = this;
    this.io.on('connection', function(socket) {

        self.sockets[socket.id] = socket;

        self._add(socket).then(function(vert) {

            socket.on('disconnect', function() {

                self._remove(vert);
            });
        });
    });
}

P2PMesh.prototype._add = function(socket) {

    var self = this;
    return this._enqueueAction(function(position) {

        var verts = self.verts.slice();
        var location = self.locator(socket.handshake.address).slice();
        location.push(socket);
        verts.push(location);

        var newGraph = self._calcNewGraph(verts);
        var regulation = self._regulate(newGraph.diff, verts, newGraph.graph, true);

        regulation.then(function() {

            self.verts = verts;
            self.graph = newGraph.graph;

            position.resolve(location);

        }, function(error) {
            position.resolve(error);
        });
    });
};

P2PMesh.prototype._remove = function(vert) {

    var self = this;
    return this._enqueueAction(function(position) {

        var verts = self.verts.slice();
        var index = verts.indexOf(vert);
        verts.splice(index, 1);

        var newGraph = self._calcNewGraph(verts);

        var regulation = self._regulate(newGraph.diff, verts, newGraph.graph);

        self.verts = verts;
        self.graph = newGraph.graph;

        regulation.then(function() {
            position.resolve();
        }, function() {
            position.resolve();
        });
    });
};

P2PMesh.prototype._regulate = function(diff, verts, graph, adding) {

    if (graph.length <= 0) {

        var resolved = Promise.resolve();
        var rejected = Promise.reject();

        for (var i = 0; i < verts.length; i++) {
            for (var j = i + 1; j < verts.length; j++) {
                this._connect(verts[i][2], verts[j][2], resolved, rejected);
            }
        }

        return resolved;
    }

    var promises = [];

    var cont = Promise.defer();
    var revert = Promise.defer();

    for (var id in diff) {
        promises.push(this._regulateNode(id, diff[id], cont.promise, revert.promise));
    }

    return Promise.all(promises).then(function() {
        cont.resolve();
        revert.reject();
    }, function() {
        if (adding) {
            revert.resolve();
            cont.reject();
        } else {
            cont.resolve();
            revert.reject();
        }
    });
};

P2PMesh.prototype._regulateNode = function(id, node, cont, revert) {

    var promises = [];
    var socketA = this.sockets[id];

    for (var id2 in node.add) {

        var socketB = this.sockets[node.add[id2]];
        promises.push(this._connect(socketA, socketB));
    }

    var self = this;

    cont.then(function() {

        for (var id2 in node.remove) {

            var socketB = self.sockets[node.remove[id2]];
            self._disconnect(socketA, socketB);
        }
    });

    revert.then(function() {

        for (var id2 in node.add) {

            var socketB = self.sockets[node.add[id2]];
            self._disconnect(socketA, socketB);
        }
    });

    return Promise.all(promises);
};

P2PMesh.prototype._connect = function(socketA, socketB) {

    var deferred = Promise.defer();

    var offerA = Promise.defer();
    var offerB = Promise.defer();

    socketA.emit('getOffer', function(offer) {

        if (offer) {
            offerA.resolve(offer);
        } else {
            offerA.reject('no offer');
        }
    });

    socketB.emit('getOffer', function(offer) {

        if (offer) {
            offerB.resolve(offer);
        } else {
            offerB.reject('no offer');
        }
    });

    Promise.all([offerA.promise, offerB.promise]).then(function(offers) {

        var connectionA = Promise.defer();
        var connectionB = Promise.defer();

        var socketBId = crypto.createHash('md5').update(socketB.id).digest('hex');
        socketA.emit('connectTo', socketBId, offers[1], function(success) {

            if (success) {
                connectionA.resolve();
            } else {
                connectionA.reject('could not connect');
            }
        });

        var socketAId = crypto.createHash('md5').update(socketA.id).digest('hex');
        socketB.emit('connectTo', socketAId, offers[0], function(success) {

            if (success) {
                connectionB.resolve();
            } else {
                connectionB.reject('could not connect');
            }
        });

        Promise.all([connectionA.promise, connectionB.promise]).then(function() {
            deferred.resolve();
        });

    }, function(error) {
        deferred.reject(error);
    });

    setTimeout(function() {
        deferred.reject('connection timeout');
    }, this.timeout);

    return deferred.promise;
};

P2PMesh.prototype._disconnect = function(socketA, socketB) {

    var socketAId = crypto.createHash('md5').update(socketA.id).digest('hex');
    var socketBId = crypto.createHash('md5').update(socketB.id).digest('hex');

    socketA.emit('disconnectFrom', socketBId);

    // Redundancy for safe measure
    socketB.emit('disconnectFrom', socketAId);
};

P2PMesh.prototype._enqueueAction = function(action) {
    this.log('enqueueing action: ' + action);
    var position = Promise.defer();
    var previous = this.chain;
    this.chain = position.promise;

    previous.then(function() {
        action(position);
    }, function() {
        action(position);
    });

    return position.promise;
};

// Calculates a new graph based on the vertices provided and performs
// a diff between the old and new graph
P2PMesh.prototype._calcNewGraph = function(verts) {

    var graph = delaunay.triangulate(verts);
    var diff = this._delaunayDiff(this.graph, this.verts, graph, verts);

    return {
        graph: graph,
        diff: diff
    };
};

// Calculates a diff of the delaunay graph representations
P2PMesh.prototype._delaunayDiff = function(d1, v1, d2, v2) {

    var table = {};

    for (var i = 0; i < d1.length; i += 3) {

        table[this._key(d1[i], d1[i+1], v1)] =
        table[this._key(d1[i+1], d1[i+2], v1)] =
        table[this._key(d1[i+2], d1[i], v1)] = 1;
    }

    for (var i = 0; i < d2.length; i += 3) {

        if (table[this._key(d2[i], d2[i+1], v2)] === 1) {
            table[this._key(d2[i], d2[i+1], v2)] = 0;
        } else if (table[this._key(d2[i], d2[i+1], v2)] !== 0) {
            table[this._key(d2[i], d2[i+1], v2)] = 2;
        }

        if (table[this._key(d2[i+1], d2[i+2], v2)] === 1) {
            table[this._key(d2[i+1], d2[i+2], v2)] = 0;
        } else if (table[this._key(d2[i+1], d2[i+2], v2)] !== 0) {
            table[this._key(d2[i+1], d2[i+2], v2)] = 2;
        }

        if (table[this._key(d2[i+2], d2[i], v2)] === 1) {
            table[this._key(d2[i+2], d2[i], v2)] = 0;
        } else if (table[this._key(d2[i+2], d2[i], v2)] !== 0) {
            table[this._key(d2[i+2], d2[i], v2)] = 2;
        }
    }

    // result[nodeId]{add:[],remove:[]}
    var result = {};

    for (var i in table) {

        var v = table[i];
        var xy = i.split("~");

        if (v === 1) {

            var node = result[xy[0]] = (result[xy[0]] || {
                add: [],
                remove: []
            });

            node.remove.push(xy[1]);
        } else if (v === 2) {

            var node = result[xy[0]] = (result[xy[0]] || {
                add: [],
                remove: []
            });

            node.add.push(xy[1]);
        }
    }

    return result;
};

P2PMesh.prototype._key = function(x, y, vs) {
    x = vs[x][2].id;
    y = vs[y][2].id;
    return x < y ? x+'~'+y : y+'~'+x;
};

module.exports = P2PMesh;
