# socket.io-p2pmesh

socket.io-p2pmesh is a WebRTC peer-to-peer mesh maintainer for node.js. It enables clients to directly communicate among each other in large networks (mesh) without ever having to communicate to the server the data which is to be transfered among clients. This takes the burden off the server which is common of large scale WebSocket applications. This component uses socket.io on the server to act as the signaler in a WebRTC connection. The client is expected to have socket.io-p2pmesh-client. The client initiates the connection, and is super easy to use.

## The Mesh Topology

The primary motivation for this was creating an efficient mesh topology that didn't overload any single client. Most existing WebRTC libraries that handle signaling allow fully connected topologies, which means that for each client in the network, it is connected to all the other clients. As you can imagine, the number of edges in a large  network grow too fast to be practical. To combat edge explosion, [Deluanay Triangulation] is used to compute an efficient network topology. On average, each client should have ~6 connections to other clients. This can be more or less for any individual client, but the average is a known property of [Deluanay Triangulation]. Below you can see how a mesh would evolve over time, with the addition and removal of clients. The blue lines represent a WebRTC connection between two clients:

![alt tag](http://i.giphy.com/xTk9ZD25IbIfVpjapO.gif)

[Deluanay Triangulation] can be computed in n-dimensional Euclidean space, although, for the present time, the mesh is computed in a 2D plane ([x,y] coords) for simplicity, as it covers many use cases.

By default, the [x,y] position of a client in the computation is completely random. This does not compute the most efficient mesh possible though. This is why, in more advanced use cases, the positioning of clients in this space can be substituted for a more desirable implementation based on the use case. Two easy, yet more efficient, examples, might be to:

1. Obtain the [lat,long] of the client's ip using some ip-geo-location lookup service. With a quick search, this looks like a free, although limited, option (https://www.npmjs.com/package/iplocation)
2. An even better approach would be to triangulate a client based on its ping to servers with known positions (physically or conceptually the network distance from the master server(s)). This would more accurately represent the network distance of clients, rather than their physical location.

## Example

It is very easy to add a p2p mesh to your application:

```js
var io = require('socket.io')(80);
var P2PMesh = require('socket.io-p2pmesh');
var p2pmesh = new P2PMesh(io);
```

That's it! When a client is connected, the mesh hooks everything up for you. The client must be running socket.io-p2pmesh-client, and connect to the namespace the mesh was provided, in the case of the example above, it would be the root namespace, but suppose you wanted to partition clients to among multiple meshes, this could be accomplished by namespacing the io instance given the P2PMesh. Likewise, the client would need to be given the correct namespace.

## API Documentation
```
//TODO - Coming soon
```
### Version
#### 0.0.1
This project is still a work in progress, and is subject to change until a stable version is reached.

### License
MIT

[//]: #
[Deluanay Triangulation]: <https://en.wikipedia.org/wiki/Delaunay_triangulation>  
