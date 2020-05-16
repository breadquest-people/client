const local = false;

const emptyTile = 128;
const blockStartTile = 129;
const blockTileAmount = 8;
const trailStartTile = 137;
const trailTileAmount = 8;
const flourTile = 145;
const waterTile = 146;
const powderTile = 147;
const breadTile = 148;
const ovenTile = 149;
const hospitalTile = 150;
const symbolStartTile = 33;
const symbolTileAmount = 94;

function walkable(tile) {
	return (
		tile !== 0 &&
		tile !== ovenTile &&
		tile !== hospitalTile &&
		(tile < blockStartTile || tile >= blockStartTile + blockTileAmount)
	);
}

let colorSet = [
	// Block colors.
	[255, 64, 64],
	[255, 128, 0],
	[192, 192, 64],
	[0, 192, 0],
	[0, 192, 192],
	[64, 64, 255],
	[192, 0, 192],
	[128, 128, 128],

	// Misc colors.
	[0, 0, 0],
	[64, 64, 64],

	// Trail colors.
	[255, 128, 128],
	[255, 192, 64],
	[224, 224, 64],
	[64, 255, 64],
	[64, 224, 224],
	[128, 128, 255],
	[255, 64, 255],
	[192, 192, 192]
];

function mod(n, m) {
	return ((n % m) + m) % m;
}

let canvas, ctx;
let ws;

let mode = "manual";

let keysDown = new Set();
let walkPath = [];

let onlinePlayers = [];
let localPlayer = {
	id: -1,
	className: "Player",
	pos: {x: 0, y: 0},
	username: null,
	avatar: null,
	bread: null
};
let localCrack = null;
let entities = [localPlayer];

const chunkSize = 128;
class Chunk {
	constructor(x, y) {
		this.x = x;
		this.y = y;
		this.data = new Uint8Array(chunkSize * chunkSize);
		this.oldData = new Uint8Array(chunkSize * chunkSize).fill(0);
		
		this.canvas = document.createElement("canvas");
		this.canvas.width = this.canvas.height = chunkSize * 8;
		this.ctx = this.canvas.getContext("2d");
		this.ctx.fillStyle = "rgb(64, 64, 64)";
		this.ctx.fillRect(0, 0, chunkSize * 8, chunkSize * 8);
		this.needsRedraw = false;
	}
	
	render() {
		if (!this.needsRedraw) return;
		this.needsRedraw = false;
		
		//this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		
		for (let y=0; y<chunkSize; y++) {
			for (let x=0; x<chunkSize; x++) {
				let index = y * chunkSize + x;
				let tile = this.data[index];
				
				if (this.oldData[index] === tile) continue;
				this.oldData[index] = tile;
				
				this.ctx.save();
				this.ctx.translate(x * 8, y * 8);
				this.ctx.clearRect(0, 0, 8, 8);
				drawTile(this.ctx, tile);
				this.ctx.restore();
			}
		}
	}
}

let chunks = {};

function chunkKey(x, y) {
	return y * (2 ** 16) + x;
}

function getTile(x, y) {
	let chunkX = Math.floor(x / chunkSize);
	let chunkY = Math.floor(y / chunkSize);
	let key = chunkKey(chunkX, chunkY);
	if (!(key in chunks)) {
		return 0;
	}
	
	let chunk = chunks[key];
	let index = mod(y, chunkSize) * chunkSize + mod(x, chunkSize);
	
	return chunk.data[index];
}

function setTile(x, y, tile) {
	let chunkX = Math.floor(x / chunkSize);
	let chunkY = Math.floor(y / chunkSize);
	let key = chunkKey(chunkX, chunkY);
	if (!(key in chunks)) {
		chunks[key] = new Chunk(chunkX, chunkY);
	}
	
	let chunk = chunks[key];
	let index = mod(y, chunkSize) * chunkSize + mod(x, chunkSize);
	
	if (chunk.data[index] === tile) return;
	
	chunk.data[index] = tile;
	chunk.needsRedraw = true;
	
	if (tile === ovenTile || tile === hospitalTile) {
		console.log("Lucky", x, y);
		if (!focused) new Notification("Lucky");
	}
}

function pathFind(tileX, tileY, condition, noGrief) {
	let open = [];
	let closed = [];
	
	open.push({x: localPlayer.pos.x, y: localPlayer.pos.y, f: 0, g: 0, h: 0, parent: null});
	
	while (open.length) {
		let bestIndex = 0;
		for (let i=0; i<open.length; i++) {
			if (open[i].f >= open[bestIndex].f) continue;
			
			bestIndex = i;
		}
		
		let best = open[bestIndex];
		open.splice(bestIndex, 1);
		closed.push(best);
		
		if (condition(best.x, best.y)) {
			let path = [];
			while (best.parent !== null) {
				let dir;
				if (best.parent.x > best.x) dir = 3;
				if (best.parent.x < best.x) dir = 1;
				if (best.parent.y > best.y) dir = 0;
				if (best.parent.y < best.y) dir = 2;
				path.push(dir);
				best = best.parent;
			}
			return path;
		}
		
		[[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(neighbor => {
			let x = best.x + neighbor[0];
			let y = best.y + neighbor[1];
			if (closed.find(n => n.x === x && n.y === y)) return;
			
			let tile = getTile(x, y);
			let weight = 1;
			if (!walkable(tile)) if (noGrief) return; else weight = 4;
			const enemyRadius = 2;
			if (entities.some(e => {
				return e.className === "Enemy" && Math.abs(e.pos.x - x) <= enemyRadius && Math.abs(e.pos.y - y) <= enemyRadius
			})) weight = 1000;
			
			let existing = open.find(n => n.x === x && n.y === y);
			let g = best.g + weight;
			let h = Math.abs(x - tileX) + Math.abs(y - tileY);
			if (existing) {
				if (g < existing.g) {
					existing.g = g;
					existing.f = g + h;
					existing.parent = best;
				}
			} else {
				open.push({
					x: x,
					y: y,
					f: g + h,
					g: g,
					h: h,
					parent: best
				});
			}
		});
	}
	
	return false;
}

function drawTile(ctx, tile) {
	let square = false;
	let small = false;
	let color;
	
	if (tile === 0) {
		square = true;
		color = 9;
	} else if (tile >= blockStartTile && tile < blockStartTile + blockTileAmount) {
		square = true;
		color = tile - blockStartTile;
	} else if (tile >= trailStartTile && tile < trailStartTile + trailTileAmount) {
		square = true;
		small = true;
		color = tile - trailStartTile + 10;
	} else if (tile >= flourTile && tile <= breadTile) {
		tile -= flourTile - 32;
	} else if (tile === ovenTile) {
		tile = 16;
	} else if (tile === hospitalTile) {
		tile = 17;
	} else if (tile >= symbolStartTile && tile < symbolStartTile + symbolTileAmount) {
		tile -= symbolStartTile - 81;
	} else {
		return;
	}
	
	if (square) {
		ctx.fillStyle = "rgb(" + colorSet[color].join(",") + ")";
		if (small) {
			ctx.fillRect(3, 3, 2, 2);
		} else {
			ctx.fillRect(0, 0, 8, 8);
		}
	} else {
		ctx.drawImage(
			tileset,
			(tile % 16) * 8, Math.floor(tile / 16) * 8,
			8, 8,
			0, 0,
			8, 8
		);
	}
}

let camera = {
	x: 0,
	y: 0,
	zoom: 8
};

let tileset = new Image();
tileset.src = (local ? "http://daydun.com" : "https://ostracodapps.com") + ":2626/images/sprites.png";

function logChat(username, text) {
	let message = document.createElement("li");
	if (username) {
		let userElem = document.createElement("span");
		userElem.className = "username";
		userElem.textContent = username;
		message.appendChild(userElem);
	}
	let content = document.createElement("span");
	content.textContent = text;
	message.appendChild(content);
	document.getElementById("chat-messages").appendChild(message);
	
	if (Date.now() - start > 10000) {
		if (!focused) new Notification(text);
	}
}

const itemNames = {
	[emptyTile]: "Empty Tile",
	[flourTile]: "Flour",
	[waterTile]: "Water",
	[powderTile]: "Baking Powder",
	[breadTile]: "Bread",
	[blockStartTile + 0]: "Red Block",
	[blockStartTile + 1]: "Orange Block",
	[blockStartTile + 2]: "Yellow Block",
	[blockStartTile + 3]: "Green Block",
	[blockStartTile + 4]: "Teal Block",
	[blockStartTile + 5]: "Blue Block",
	[blockStartTile + 6]: "Purple Block",
	[blockStartTile + 7]: "Gray Block",
	[ovenTile]: "Oven",
	[hospitalTile]: "Hospital"
};

let selectedItem = null;

function updateInventory(inv) {
	document.getElementById("inventory-items").innerHTML = "";
	let elems = {};
	for (let id in inv) {
		id = parseInt(id);
		let itemElem = document.createElement("li");
		itemElem.className = "item";
		let icon = document.createElement("canvas");
		icon.className = "icon";
		icon.width = icon.height = 8;
		drawTile(icon.getContext("2d"), id);
		let name = document.createElement("span");
		name.className = "name";
		name.textContent = itemNames[id];
		let count = document.createElement("span");
		count.className = "count";
		count.textContent = inv[id];
		itemElem.appendChild(icon);
		itemElem.appendChild(name);
		itemElem.appendChild(count);
		
		itemElem.addEventListener("click", function() {
			if (selectedItem !== null) {
				elems[selectedItem].classList.remove("active");
			}
			if (id === selectedItem) {
				selectedItem = null;
				return;
			}
			itemElem.classList.add("active");
			selectedItem = id;
		});
		
		elems[id] = itemElem;
		document.getElementById("inventory-items").appendChild(itemElem);
	}
	
	if (selectedItem !== null) {
		elems[selectedItem].classList.add("active");
	}
}

function tick() {
	queueCommands([
		{commandName: "assertPos", pos: localPlayer.pos},
		{commandName: "getEntities"},
		{commandName: "getTiles", size: 50},
		{commandName: "getChatMessages"},
		{commandName: "getOnlinePlayers"},
		{commandName: "getInventoryChanges"},
		{commandName: "getRespawnPosChanges"},
		{commandName: "getStats"},
		{commandName: "getAvatarChanges"}
	]);
	
	document.getElementById("pos-x").textContent = localPlayer.pos.x;
	document.getElementById("pos-y").textContent = localPlayer.pos.y;
	
	document.getElementById("players").innerHTML = "";
	for (let i=0; i<onlinePlayers.length; i++) {
		let player = document.createElement("li");
		player.textContent = onlinePlayers[i];
		document.getElementById("players").appendChild(player);
	}
	
	ws.send(JSON.stringify(cmdQueue));
	cmdQueue = [];
	
	if (mode === "hunt") {
		walkPath = pathFind(localPlayer.pos.x, localPlayer.pos.y, function(x, y) {
			let tile = getTile(x, y);
			return tile === 0 || (tile >= flourTile && tile <= breadTile);
		});
	}
	
	document.getElementById("stat-ping").textContent = Date.now() - lastTick + "ms";
	lastTick = Date.now();
	
	if (localCrack !== null && getTile(localCrack.pos.x, localCrack.pos.y) === emptyTile) {
		localCrack = null;
	}
}

let lastInput = 0;
let directions = [{x: 0, y: -1}, {x: 1, y: 0}, {x: 0, y: 1}, {x: -1, y: 0}];

function render() {
	// Input
	if (Date.now() - lastInput > 1000 / 16 && localCrack === null) {
		let direction = null;
		if (keysDown.has("KeyW")) {
			direction = 0;
		} else if (keysDown.has("KeyD")) {
			direction = 1;
		} else if (keysDown.has("KeyS")) {
			direction = 2;
		} else if (keysDown.has("KeyA")) {
			direction = 3;
		}
		
		let place = false;
		let fromPath = false;
		if (direction === null && walkPath.length) {
			direction = walkPath.pop();
			if (direction >= 4) {
				direction -= 4;
				place = true;
			}
			fromPath = true;
		} else if (direction !== null) {
			walkPath = [];
			mode = "manual";
		}
		
		if (direction !== null) {
			let newPos = {
				x: localPlayer.pos.x + directions[direction].x,
				y: localPlayer.pos.y + directions[direction].y,
			};
			
			let tile = getTile(newPos.x, newPos.y);
			
			if (place) {
				queueCommands([{commandName: "placeTile", direction: direction, tile: selectedItem}]);
			} else if (
				(document.getElementById("break-walls").checked || fromPath) && 
				(tile >= blockStartTile && tile < blockStartTile + blockTileAmount)
			) {
				if (fromPath) walkPath.push(direction);
				queueCommands([{commandName: "removeTile", direction: direction}]);
				localCrack = {
					className: "Crack",
					pos: {x: newPos.x, y: newPos.y}
				};
				entities.push(localCrack);
				lastInput = Date.now();
			} else if (
				document.getElementById("break-walls").checked && (
				//(tile >= flourTile && tile <= breadTile) ||
				(tile >= symbolStartTile && tile < symbolStartTile + symbolTileAmount)
			)) {
				queueCommands([{commandName: "collectTile", direction: direction}]);
				lastInput = Date.now();
			} else if (walkable(tile)) {
				queueCommands([{commandName: "walk", direction: direction}]);
				//setTile(newPos.x, newPos.y, trailStartTile + localPlayer.avatar);
				localPlayer.pos = newPos;
				lastInput = Date.now();
			}
		}
	}
	
	camera.x = localPlayer.pos.x;
	camera.y = localPlayer.pos.y;
	
	// Draw
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	
	ctx.save();
	ctx.translate(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2));
	ctx.scale(camera.zoom, camera.zoom);
	ctx.save();
	ctx.translate(-camera.x, -camera.y);
	
	let startY = Math.floor((camera.y - canvas.height / 2 / camera.zoom) / chunkSize);
	let endY = Math.ceil((camera.y + canvas.height / 2 / camera.zoom) / chunkSize);
	let startX = Math.floor((camera.x - canvas.width / 2 / camera.zoom) / chunkSize);
	let endX = Math.ceil((camera.x + canvas.width / 2 / camera.zoom) / chunkSize);
	
	for (let y=startY; y<=endY; y++) {
		for (let x=startX; x<=endX; x++) {
			let chunk = chunks[chunkKey(x, y)];
			if (!chunk) continue;
			
			chunk.render();
			ctx.drawImage(chunk.canvas, chunk.x * chunkSize, chunk.y * chunkSize, chunkSize, chunkSize);
			ctx.lineWidth = 1 / 16;
			ctx.strokeRect(chunk.x * chunkSize, chunk.y * chunkSize, chunkSize, chunkSize);
		}
	}
	
	entities.forEach(entity => {
		if (entity.className === "Player") {
			ctx.drawImage(
				tileset,
				entity.avatar * 8, 0,
				8, 8,
				entity.pos.x, entity.pos.y,
				1, 1
			);
		} else if (entity.className === "Crack") {
			ctx.drawImage(tileset, 0, 32, 8, 8, entity.pos.x, entity.pos.y, 1, 1);
		} else if (entity.className === "Enemy") {
			ctx.drawImage(tileset, 0, 24, 8, 8, entity.pos.x, entity.pos.y, 1, 1);
		}
	});
	
	ctx.restore();
	
	// Path finding
	ctx.strokeStyle = "#f00";
	ctx.lineWidth = 0.1;
	ctx.beginPath();
	ctx.moveTo(0.5, 0.5);
	let x = 0;
	let y = 0;
	for (let i=walkPath.length - 1; i>=0; i--) {
		if (walkPath[i] === 0) y--;
		if (walkPath[i] === 1) x++;
		if (walkPath[i] === 2) y++;
		if (walkPath[i] === 3) x--;
		ctx.lineTo(x + 0.5, y + 0.5);
	}
	ctx.stroke();
	
	// Spawn radius
	ctx.strokeStyle = "#f00";
	//ctx.globalAlpha = 0.1;
	ctx.strokeRect(-20, -20, 41, 41);
	
	// Entity FOV
	ctx.strokeStyle = "#000";
	//ctx.globalAlpha = 0.1;
	ctx.strokeRect(-40, -40, 81, 81);
	
	// Tile FOV
	ctx.strokeStyle = "#00f";
	ctx.strokeRect(-25, -25, 50, 50);
	
	ctx.restore();
	
	window.requestAnimationFrame(render);
}

function resize() {
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	ctx.imageSmoothingEnabled = false;
}

let cmdQueue = [];

function queueCommands(cmd) {
	cmdQueue.push(...cmd);
}

let focused = true;
window.addEventListener("blur", function() {
	focused = false;
});
window.addEventListener("focus", function() {
	focused = true;
});

let dataSize = 0;
let lastDataSize = 0;
let lastTick = 0;
let ticks = 0;

setInterval(function() {
	document.getElementById("stat-bandwidth").textContent = (dataSize - lastDataSize) / 1000 + "KB/s";
	lastDataSize = dataSize;
	document.getElementById("stat-tps").textContent = ticks;
	ticks = 0;
}, 1000);

/*setInterval(function() {
	let data = {};
	for (let key in chunks) {
		data[key] = btoa(String.fromCharCode(...chunks[key].data));
	}
	localStorage.setItem("bq:world", JSON.stringify(data));
}, 10000);*/

let start = Date.now();

window.addEventListener("load", function() {
	canvas = document.getElementById("canvas");
	ctx = canvas.getContext("2d");
	
	resize();
	window.addEventListener("resize", resize);
	
	window.addEventListener("keydown", event => {
		if (document.activeElement === chatInput) return;
		keysDown.add(event.code);
	});
	window.addEventListener("keyup", event => {
		keysDown.delete(event.code);
	});
	
	window.addEventListener("wheel", event => {
		if (event.deltaY < 0) {
			camera.zoom *= Math.sqrt(2);
		} else {
			camera.zoom /= Math.sqrt(2);
		}
	});
	
	document.getElementById("hunt-mode").addEventListener("click", function() {
		mode = "hunt";
	});
	
	canvas.addEventListener("click", event => {
		let x = Math.floor((event.clientX - canvas.width / 2) / camera.zoom + camera.x);
		let y = Math.floor((event.clientY - canvas.height / 2) / camera.zoom + camera.y);
		
		
		/*if (selectedItem !== null && Math.abs(dx) + Math.abs(dy) === 1) {
			let direction = 0;
			if (dx === 0 && dy === -1) direction = 0;
			if (dx === 1 && dy === 0) direction = 1;
			if (dx === 0 && dy === 1) direction = 2;
			if (dx === -1 && dy === 0) direction = 3;
			queueCommands([{commandName: "placeTile", direction: direction, tile: selectedItem}]);
			return;
		}*/
		
		if (selectedItem !== null) {
			let direction;
			let path = pathFind(x, y, function(bestX, bestY) {
				let cond = Math.abs(bestX - x) + Math.abs(bestY - y) === 1;
				if (cond) {
					let dx = x - bestX;
					let dy = y - bestY;
					if (dx === 0 && dy === -1) direction = 0;
					if (dx === 1 && dy === 0) direction = 1;
					if (dx === 0 && dy === 1) direction = 2;
					if (dx === -1 && dy === 0) direction = 3;
				}
				return cond;
			}, true);
			
			if (!path) {
				logChat(null, "Destionation unreachable");
			}
			path.unshift(direction + 4);
			
			walkPath = path;
		} else {
			let path = pathFind(x, y, function(bestX, bestY) {
				return bestX === x && bestY === y;
			});
			
			if (!path) {
				logChat(null, "Destionation unreachable");
			}
			
			walkPath = path;
		}
	});
	
	let chatInput = document.getElementById("chat-input");
	window.addEventListener("keydown", event => {
		if (event.code === "Enter" && document.activeElement !== chatInput) {
			chatInput.focus();
		}
	});
	chatInput.addEventListener("keydown", event => {
		if (event.code === "Enter") {
			if (chatInput.value) {
				queueCommands([{commandName: "addChatMessage", text: chatInput.value}]);
			}
			chatInput.value = "";
			chatInput.blur();
			event.stopPropagation();
		}
	});
	chatInput.addEventListener("focus", event => {
		document.getElementById("chat").classList.add("active");
	});
	chatInput.addEventListener("blur", event => {
		document.getElementById("chat").classList.remove("active");
	});
	
	ws = new WebSocket((local ? "ws://daydun.com" : "wss://ostracodapps.com") + ":2626/gameUpdate");
	ws.addEventListener("open", function() {
		logChat("[WebSocket]", "open");
		
		queueCommands([
			{commandName: "startPlaying"},
			{commandName: "getGuidelinePos"}
		]);
		
		setInterval(tick, 1000 / 16);
	});
	ws.addEventListener("close", function() {
		logChat("[WebSocket]", "close");
	});
	ws.addEventListener("message", function(event) {
		dataSize += event.data.length;
		ticks++;
		
		let data = JSON.parse(event.data);
		//console.log(data);
		
		if (!data.success) {
			logChat("[Server Error]", data.message);
			return;
		}
		
		for (let i=0; i<data.commandList.length; i++) {
			let cmd = data.commandList[i];
			switch (cmd.commandName) {
				case "setLocalPlayerInfo":
					logChat(null, `Logged in as ${cmd.username}`);
					localPlayer.username = cmd.username;
					localPlayer.avatar = cmd.avatar;
					localPlayer.bread = cmd.breadCount;
					break;
				case "setInventory":
					//logChat(null, "Got inventory");
					updateInventory(cmd.inventory);
					break;
				case "setRespawnPos":
					logChat(null, `Respawn pos [${cmd.respawnPos.x}, ${cmd.respawnPos.y}]`);
					break;
				case "setLocalPlayerPos":
					//logChat(null, `Player pos [${cmd.pos.x}, ${cmd.pos.y}]`);
					console.log("Move", localPlayer.pos.x, localPlayer.pos.y, "->", cmd.pos.x, cmd.pos.y);
					localPlayer.pos = cmd.pos;
					lastInput = Date.now();
					break;
				case "removeAllEntities":
					entities = [localPlayer];
					if (localCrack !== null) entities.push(localCrack);
					break;
				case "removeAllOnlinePlayers":
					onlinePlayers = [];
					break;
				case "setTiles":
					for (let y=0; y<cmd.size; y++) {
						for (let x=0; x<cmd.size; x++) {
							setTile(cmd.pos.x + x, cmd.pos.y + y, cmd.tileList[y * cmd.size + x]);
						}
					}
					break;
				case "addChatMessage":
					logChat(cmd.username, cmd.text);
					break;
				case "addOnlinePlayer":
					onlinePlayers.push(cmd.username);
					break;
				case "setStats":
					cmd.health;
					cmd.isInvincible;
					
					document.getElementById("health-value").textContent = cmd.health + " / 5";
					document.getElementById("health-bar").style.width = cmd.health / 5 * 100 + "%";
					
					if (cmd.health < localPlayer.health) {
						if (!focused) new Notification("Took damage!");
					}
					
					localPlayer.health = cmd.health;
					break;
				case "addEntity":
					let entity = cmd.entityInfo;
					entities.push(entity);
					break;
			}
		}
	});
	
	if (Notification.permission !== "granted") {
		Notification.requestPermission();
	}
	
	window.requestAnimationFrame(render);
});