// ==UserScript==
// @name           Trellonest
// @description    This extension enables nested boards in Trello
// @include        https://trello.com/*
// @version        1.0
// ==/UserScript==

(function ($) {
	var trelloAPI = "https://trello.com/1/";

	function getLoginToken() {
		var token = document.cookie.match(/token=(.*?)(;|$)/);
		return (token && unescape(token[1])) || null;
	}

	function getBoard(cb) {
		var boardMatch = window.location.pathname.match(/^\/b\/(.*?)(\/|$)/);
		if (boardMatch) {
			var board = boardMatch && boardMatch[1];
			if (board) {
				$.get(trelloAPI + "boards/" + board + "?fields=id")
					.done(function (resp) {
						boardCache = resp.id;
						cb(null, resp.id);
					})
					.fail(function (xhr, status, err) {
						cb(err);
					});
			} else {
				cb(null, null);
			}
		} else {
			var cardMatch = window.location.pathname.match(/^\/c\/(.*?)(\/|$)/);
			if (cardMatch) {
				var card = cardMatch && cardMatch[1];

				$.get(trelloAPI + "cards/" + card + "?fields=idBoard")
					.done(function (resp) {
						boardCache = resp.idBoard;
						cb(null, resp.idBoard);
					})
					.fail(function (xhr, status, err) {
						cb(err);
					});
			} else {
				cb(new Error("Unsupported trello page"));
			}
		}
	}

	function getActiveCard() {
		var cardMatch = window.location.pathname.match(/^\/c\/(.*?)(\/|$)/);
		if (!cardMatch) return null;
		var card = cardMatch && cardMatch[1];
		return card || null;
	}

	var currentSocket;
	function establishSocket() {
		var token = getLoginToken();

		getBoard(function (err, boardId) {
			if (currentSocket) {
				currentSocket.close();
				currentSocket = null;
			}

			var reqId = 0;
			var socket = new WebSocket("wss://trello.com/1/Session/socket?token=" + token);
			currentSocket = socket;
			socket.onopen = function () {
				socket.send(JSON.stringify({ type: "ping", reqid: reqId++ }));
				socket.send(JSON.stringify({ type: "subscribe", modelType: "Board", idModel: boardId, tags: ["clientActions", "updates"], invitationTokens: [], reqid: reqId++ }));
			};

			socket.onmessage = function (msg) {
				if (!msg.data) return;

				var data = JSON.parse(msg.data);
				if (!data.notify || data.notify.typeName !== "Card" || data.notify.event !== "updateModels") return;

				var deltas = {};
				for (var i = 0; i < data.notify.deltas.length; ++i) {
					if (data.notify.deltas[i].desc !== undefined) {
						deltas[data.notify.deltas[i].id] = data.notify.deltas[i].desc;
					}
				}

				var keys = Object.keys(boardCards);
				for (var i = 0; i < keys.length; ++i) {
					if (deltas[boardCards[keys[i]].id] !== undefined) {
						boardCards[keys[i]].desc = deltas[boardCards[keys[i]].id];
					}
				}
			};
		});
	}

	function linkCardToBoard(cardId, targetBoard, cb) {
		var oldDesc = boardCards[cardId].desc;
		var newDesc = oldDesc ? oldDesc.replace(/\[\/\/\]:\s*#board\s*\((.*?)\)/, "[//]:#board(" + targetBoard + ")") : "[//]:#board(" + targetBoard + ")";

		if (oldDesc === newDesc) {
			newDesc += "\r\n\r\n[//]:#board(" + targetBoard + ")";
		}

		$.ajax({
			type: "PUT",
			url: trelloAPI + "cards/" + cardId,
			data: {
				desc: newDesc,
				token: getLoginToken(),
				invitationTokens: []
			}
		}).done(function () {
			if (!cb) return;
			cb(null);
		})
		.fail(function (xhr, _, err) {
			if (!cb) return;
			cb(err);
		});
	}

	function addLinkButton(buttonContainer) {
		var linkBtn = $('<a href="#" class="button-link js-link-board-card" title="Link this card to another board."> <span class="icon-sm icon-card"></span> Link </a>');
		buttonContainer.append(linkBtn);

		linkBtn.on("click", function () {
			var card = getActiveCard();
			if (!card) return alert("Could not parse card id");

			var target = prompt("Please provide the target board id");
			if (target === null) return;

			linkCardToBoard(card, target);
		});
	}

	function addCreateButton(buttonContainer) {
		var createBtn = $('<a href="#" class="button-link js-create-board-card" title="Create a new board from this card."> <span class="icon-sm icon-card"></span> Create board </a>');
		buttonContainer.append(createBtn);

		createBtn.on("click", function () {
			var cardId = getActiveCard();
			if (!cardId) return alert("Could not parse card id");

			var card = boardCards[cardId];
			$.post(trelloAPI + "boards?fields=url", { name: card.name, desc: card.desc, token: getLoginToken() }, function (e) {
				var card = getActiveCard();
				linkCardToBoard(card, e.url.match(/\/b\/(.*?)(\/|$)/)[1], function (err) {
					if (err) alert("Failed to link card to the new board, please retry linking it later!");

					window.open(e.url);
				});
			});
		});
	}

	function addButtons() {
		var objects = $(".card-detail-window .window-module.other-actions div:last-child");
		if (!objects.length) return setTimeout(addButtons, 1000);

		if ($(".js-link-board-card", objects).length === 0) {
			addLinkButton(objects);
		}
		if ($(".js-create-board-card", objects).length === 0) {
			addCreateButton(objects);
		}
	}

	var refreshingCards = false;
	var boardCards = null;
	function refreshCards() {
		if (refreshingCards) return;

		refreshingCards = true;
		getBoard(function (err, id) {
			if (err) {
				refreshingCards = false;
				return;
			}

			$.get(trelloAPI + "boards/" + id + "/cards?fields=id,name,desc,shortLink", function (cards) {
				boardCards = {};
				for (var i = 0; i < cards.length; ++i) {
					boardCards[cards[i].shortLink] = cards[i];
				}
			}).always(function () {
				refreshingCards = false;
			});
		});
	}

	function getBoardFromCard(card) {
		if (!boardCards) {
			refreshCards();
			establishSocket();
			return null;
		}

		var href = $(".list-card-title", card).attr("href");
		if (!href) return null;

		var cardId = href.match(/^\/c\/(.*?)(\/|$)/)[1];
		var cardData = boardCards[cardId];
		if (!cardData) {
			refreshCards();
			establishSocket();
			return null;
		}

		var match = cardData.desc && cardData.desc.match(/\[\/\/\]:\s*#board\s*\((.*?)\)/);
		return (match && match[1]) || null;
	}

	refreshCards();
	establishSocket();
	addButtons();

	var ignoreEvent = false;
	document.addEventListener("click", function (e) {
	  if (ignoreEvent) return;

	  var $target = $(e.target);
	  var card = $target.parents(".list-card");
	  if (card.length === 0) return;

	  addButtons();

		var board = getBoardFromCard(card);
		if (!board) return;

		if ($target.is('.icon-edit') || $target.parents(".icon-edit").length) {

		  ignoreEvent = true;
		  $target.parents(".list-card").trigger('click');
		  ignoreEvent = false;
		} else {
		  window.location.href = "/b/" + board;
		}

		e.preventDefault();
		e.stopImmediatePropagation();
	}, true); // have to set useCapture because trello stops bubbling

	$(document).on("mouseenter", "#board .list-card", function () {
		var card = this;

		var board = getBoardFromCard(card);
		var penIcon = $(".icon-edit", this);

		if (board && !penIcon.next().is(".icon-card")) {
			var cardIcon = penIcon.clone()
															.removeClass("icon-edit")
															.addClass("icon-card")
															.css("top", "25px");
			penIcon.after(cardIcon);
		} else if (!board && penIcon.next().is(".icon-card")) {
			penIcon.next().remove();
		}
	});
})(jQuery);
