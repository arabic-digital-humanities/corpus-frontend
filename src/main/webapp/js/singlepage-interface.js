/* global BLS_URL, URI, PROPS_IN_COLUMNS saveAs */

/**
 * Dictionary where key == propertyId and value is array of containing the values for that id, in order of occurance.
 * Available properties are contained in SINGLEPAGE.INDEX.complexFields['complexFieldId'].properties['propertyId']
 *
 * The 'punct' property is always available.
 *
 * @typedef {Object.<string, Array.<string>} BLHitContext
 */

/**
 * @typedef {Object} BLHit
 *
 * @property {string} docPid - id of the document from which the hit originated
 * @property {number} start - index of first token in hit, inclusive
 * @property {number} end - index of last token in hit, exclusive
 * @property {BLHitContext} left - context before the hit
 * @property {BLHitContext} match - context of the hit, may contain more than 1 value per property if query matched multiple tokens
 * @property {BLHitContext} right - context after the hit
 */

var SINGLEPAGE = SINGLEPAGE || {};

/**
 * Responsible for converting search results to html.
 * Also contains functions to clear old results from the page.
 * Does not manage the main search form.
 */
SINGLEPAGE.INTERFACE = (function() {
	'use strict';

	var ELLIPSIS = String.fromCharCode(8230);

	var PROPS = {};
	// Gather up all relevant properties of words in this index
	PROPS.all = $.map(SINGLEPAGE.INDEX.complexFields, function(complexField) {
		return $.map(complexField.properties, function(prop, propId) {
			if (prop.isInternal)
				return null; // skip prop
			return {
				id: propId,
				displayName: prop.displayName || propId,
				isMainProp: propId === complexField.mainProperty
			};
		});
	});

	/** Columns configured in PROPS_IN_COLUMNS, can contain duplicates */
	PROPS.shown = $.map(PROPS_IN_COLUMNS, function(propId) {
		return $.map(PROPS.all, function(prop) {
			return (prop.id === propId) ? prop : undefined;
		});
	});

	// There is always at least a single main property.
	// TODO this shouldn't be required, mainProperties from multiple complexFields should be handled properly
	// but this has some challenges in the hits table view, such as that it would show mulitple columns for the before/hit/after contexts
	PROPS.firstMainProp = PROPS.all.filter(function(prop) { return prop.isMainProp; })[0];


	// Add a 'hide' function to bootstrap tabs
	// Doesn't do more than remove classes and aria labels, and fire some events
	$.fn.tab.Constructor.prototype.hide = function() {
		var $this    = this.element;
		var selector = $this.data('target') || $this.attr('href');

		var hideEvent = $.Event('hide.bs.tab', {
			relatedTarget: $this[0]
		});

		$this.trigger(hideEvent);
		if (hideEvent.isDefaultPrevented())
			return;

		$this.closest('li.active')
			.removeClass('active')
			.attr('aria-expanded', false)
			.trigger({
				type: 'hidden.bs.tab',
				relatedTarget: this[0]
			});
		$(selector).removeClass('active');
	};

	/**
	 * @param {BLHitContext} context
	 * @param {string} prop - property to retrieve
	 * @param {boolean} doPunctBefore - add the leading punctuation?
	 * @param {string} addPunctAfter - trailing punctuation to append
	 * @returns {string} concatenated values of the property, interleaved with punctuation from context['punt']
	 */
	function words(context, prop, doPunctBefore, addPunctAfter) {
		var parts = [];
		var n = context[prop] ? context[prop].length : 0;
		for (var i = 0; i < n; i++) {
			if ((i == 0 && doPunctBefore) || i > 0)
				parts.push(context.punct[i]);
			parts.push(context[prop][i]);
		}
		parts.push(addPunctAfter);
		return parts.join('');
	}

	/**
	 * @param {BLHit} hit - the hit
	 * @param {string} [prop] - property of the context to retrieve, defaults to PROPS.firstMainProp (usually 'word')
	 * @returns {Array.<string>} - string[3] where [0] == before, [1] == hit and [2] == after, values are strings created by
	 * concatenating and alternating the punctuation and values itself
	 */
	function snippetParts(hit, prop) {
		prop = prop || PROPS.firstMainProp.id;

		var punctAfterLeft = hit.match.word.length > 0 ? hit.match.punct[0] : '';
		var before = words(hit.left, prop, false, punctAfterLeft);
		var match = words(hit.match, prop, false, '');
		var after = words(hit.right, prop, true, '');
		return [before, match, after];
	}

	/**
	 * Concat all properties in the context into a large string
	 *
	 * @param {BLHitContext} context
	 * @returns {string}
	 */
	function properties(context) {
		var props = [];
		for (var key in context) {
			if (context.hasOwnProperty(key)) {
				var val = $.trim(context[key]);
				if (!val) continue;
				props.push(key+': '+val);
			}
		}
		return props.join(', ');
	}

	/**
	 * Fade out the table, then replace its contents, and call a function.
	 *
	 * @param {object} $table
	 * @param {string} html Table head and body
	 * @param {function} [onComplete] callback, will be called in the context of $table
	 */
	function replaceTableContent($table, html, onComplete) {
		// skip the fadeout if the table is empty
		// fixes annoying mini-delay when first viewing results
		var fadeOutTime = $table.find('tr').length ? 200 : 0;

		$table.animate({opacity: 0}, fadeOutTime, function () {
			$table.html(html);
			if (onComplete)
				onComplete.call($table);
			$table.animate({opacity: 1}, 200);
		});
	}

	/**
	 * Request and display more preview text from a document.
	 *
	 * @param {any} concRow the <tr> element for the current hit. The result will be displayed in the row following this row.
	 * @param {any} docPid id/pid of the document
	 * @param {number} start
	 * @param {number} end
	 * @param {('ltr' | 'rtl')} textDirection - to determine whether to specify text direction on the preview text
	 */
	function showCitation(concRow, docPid, start, end, textDirection) {
		// Open/close the collapsible in the next row
		var $element = $(concRow).next().find('.collapse');
		$element.collapse('toggle');

		$.ajax({
			url: BLS_URL + 'docs/' + docPid + '/snippet',
			dataType: 'json',
			data: {
				hitstart: start,
				hitend: end,
				wordsaroundhit: 50
			},
			success: function (response) {
				var parts = snippetParts(response);
				$element.html('<span dir="'+ textDirection+'"><b>Kwic: </b>'+ parts[0] + '<b>' + parts[1] + '</b>' + parts[2]+ '</span>');
			},
			error: function(jqXHR, textStatus/*, errorThrown*/) {
				$element.text('Error retrieving data: ' + (jqXHR.responseJSON && jqXHR.responseJSON.error) || textStatus);
			}
		});
	}

	/**
	 * Request and display properties of the matched word.
	 *
	 * @param {any} propRow the <tr> element for the current hit. The result will be displayed in the second row following this row.
	 * @param {any} props the properties to show
	 */
	function showProperties(propRow, props) {
		// Open/close the collapsible in the next row
		var $element = $(propRow).next().next().find('.collapse');
		$element.collapse('toggle');

		var $p = $('<div/>').text(props).html();
		$element.html('<span><b>Properties: </b>' + $p + '</span>');
	}

	/**
	 * Show the error reporting field and display any errors that occured when performing a search.
	 *
	 * Can be directly used as callback fuction to $.ajax
	 *
	 * @param {any} jqXHR
	 * @param {any} textStatus
	 * @param {any} errorThrown
	 */
	function showBlsError(jqXHR, textStatus, errorThrown) {
		var errordata = (jqXHR && jqXHR.responseJSON && jqXHR.responseJSON.error) || {
			'code': 'WEBSERVICE_ERROR',
			'message': 'Error contacting webservice: ' + textStatus + '; ' + errorThrown
		};

		$('#errorDiv').text(errordata.message + ' (' + errordata.code + ') ').show();
	}

	/**
	 * Hide the error field.
	 */
	function hideBlsError() {
		$('#errorDiv').text('(error here)').hide();
	}

	/**
	 * Create pagination buttons based on a set of results.
	 *
	 * Buttons contain a data-page attribute containing the page index they're displaying - 1.
	 *
	 * @param {any} $pagination <ul> element where the generated pagination will be placed.
	 * @param {any} data a blacklab-server search response containing either groups, docs, or hits.
	 */
	function updatePagination($pagination, data) {
		var beginIndex = data.summary.windowFirstResult;
		var pageSize = data.summary.requestedWindowSize;
		var totalResults;
		if (data.summary.numberOfGroups != null)
			totalResults = data.summary.numberOfGroups;
		else
			totalResults = (data.hits ? data.summary.numberOfHitsRetrieved : data.summary.numberOfDocsRetrieved);

		// when out of bounds results, draw at least the last few pages so the user can go back
		if (totalResults < beginIndex)
			beginIndex = totalResults+1;

		var totalPages =  Math.ceil(totalResults / pageSize);
		var currentPage = Math.ceil(beginIndex / pageSize);
		var startPage = Math.max(currentPage - 10, 0);
		var endPage = Math.min(currentPage + 10, totalPages);

		var html = [];
		if (currentPage == 0)
			html.push('<li class="disabled"><a>Prev</a></li>');
		else
			html.push('<li><a href="javascript:void(0)" data-page="', currentPage-1, '">Prev</a></li>');

		if (startPage > 0)
			html.push('<li class="disabled"><a>...</a></li>');

		for (var i = startPage; i < endPage; i++) {
			var showPageNumber = i + 1;
			if (i == currentPage)
				html.push('<li class="active"><a>', showPageNumber, '</a></li>');
			else
				html.push('<li><a href="javascript:void(0)" data-page="', i, '">', showPageNumber, '</a></li>');
		}

		if (endPage < totalPages)
			html.push('<li class="disabled"><a>...</a></li>');

		if (currentPage == (totalPages - 1) || totalPages == 0)
			html.push('<li class="disabled"><a>Next</a></li>');
		else
			html.push('<li><a href="javascript:void(0)" data-page="', currentPage + 1, '">Next</a></li>');

		$pagination.html(html.join(''));
	}

	/**
	 * After a small delay, clear the tab's current data and show a spinner.
	 *
	 * The delay exists because it's jarring when the user switches page and all content is removed
	 * and then displayed again within a fraction of a second.
	 *
	 * @param {any} $tab the tab content container.
	 */
	function showSearchIndicator($tab) {
		if ($tab.data('searchIndicatorTimeout') == null) {
			$tab.data('searchIndicatorTimeout', setTimeout(function() {
				$tab.find('.searchIndicator').show();
				clearTabResults($tab);
			}, 500));
		}
	}

	/**
	 * Hide any currently displayed spinner within this tab, and remove any queued spinner (see showSearchIndicator).
	 *
	 * @param {any} $tab the tab's main content container.
	 */
	function hideSearchIndicator($tab) {
		if ($tab.data('searchIndicatorTimeout') != null) {
			clearTimeout($tab.data('searchIndicatorTimeout'));
			$tab.removeData('searchIndicatorTimeout');
		}
		$tab.find('.searchIndicator').hide();
	}

	/**
	 * Load and display results within a specific group of documents/hits.
	 *
	 * This function should only be called when the containing tab currently has a groupBy clause,
	 * otherwise an invalid search will be generated.
	 *
	 * This function assumes it's being called in the context of a button/element containing a data-group-id attribute
	 * specifiying a valid group id.
	 */
	function viewConcordances() {
		var $button = $(this);
		var groupId = $button.data('groupId');

		// this parameter is local to this tab, as the other tabs are probably displaying other groups.
		$(this).trigger('localParameterChange', {
			viewGroup: groupId,
			page: 0
		});


		// initialize the display indicating we're looking at a detailed group

		// Only set the text, don't show it yet
		// (it should always be hidden, as this function is only available/called when you're not currently viewing contents of a group)
		// This is a brittle solution, but better than nothing for now.
		// TODO when blacklab-server echoes this data in the search request, set these values in setTabResults() and remove this here
		var groupName = $button.data('groupName');
		var $tab = $button.closest('.tab-pane');
		var $resultgroupdetails = $tab.find('.resultgroupdetails');
		var $resultgroupname = $resultgroupdetails.find('.resultgroupname');
		$resultgroupname.text(groupName || '');
	}

	/**
	 * Loads and displays a small amount of details about individual hits/documents within a specific group.
	 * Some data is attached to the button to track how many concordances are already loaded/are available.
	 *
	 * This function does not refresh the entire tab's contents, just inserts some extra data within a group's <tr>
	 * For the version that loads the full result set and displays the extensive information, see {@link viewConcordances}
	 *
	 * This function assumes it's being called within the context of a button element containing a data-group-id attribute.
	 * Some assumptions are also made about the exact structure of the document regarding placement of the results.
	 */
	function loadConcordances() {
		var $button = $(this);
		var $tab = $button.parents('.tab-pane').first();
		var textDirection = SINGLEPAGE.INDEX.textDirection || 'ltr';
		var groupId = $button.data('groupId');
		var currentConcordanceCount = $button.data('currentConcordanceCount') || 0;
		var availableConcordanceCount = $button.data('availableConcordanceCount') || Number.MAX_VALUE;

		if (currentConcordanceCount >= availableConcordanceCount)
			return;

		var searchParams = $.extend(
			{},
			$tab.data('defaultParameters'),
			$tab.data('parameters'),
			{
				pageSize: 20,
				page: currentConcordanceCount / 20,
				viewGroup: groupId,
				sampleSize: null,
				sampleMode: null,
				sampleSeed: null,
			},
			$tab.data('constParameters')
		);

		SINGLEPAGE.BLS.search(searchParams, function(data) {
			var totalConcordances = data.hits ? data.summary.numberOfHitsRetrieved : data.summary.numberOfDocsRetrieved;
			var loadedConcordances = data.summary.actualWindowSize;

			// store new number of loaded elements
			$button.data('currentConcordanceCount', currentConcordanceCount + loadedConcordances)
				.data('availableConcordanceCount', totalConcordances)
				.toggle(currentConcordanceCount + loadedConcordances < totalConcordances);

			// And generate html to display
			var html = [];
			// Only one of these will run depending on what is present in the data
			// And what is present in the data depends on the current view, so all works out
			$.each(data.hits, function(index, hit) {
				var parts = snippetParts(hit);
				var left = textDirection=='ltr'? parts[0] : parts[2];
				var right = textDirection=='ltr'? parts[2] : parts[0];
				html.push(
					'<div class="clearfix">',
						'<div class="col-xs-5 text-right">', ELLIPSIS, ' ', left, '</div>',
						'<div class="col-xs-2 text-center"><b>', parts[1], '&nbsp;', '</b></div>',
						'<div class="col-xs-5">', right, ' ', ELLIPSIS, '</div>',
					'</div>');
			});

			$.each(data.docs, function(index, doc) {
				var title = doc.docInfo[data.summary.docFields.titleField];
				var hits = doc.numberOfHits;
				html.push(
					'<div class="clearfix">',
						'<div class="col-xs-10"><b>', title, '&nbsp;', '</b></div>',
						'<div class="col-xs-2">', hits, '&nbsp;', '</div>',
					'</div>');
			});

			// TODO tidy up
			$button.parent().parent().append(html.join(''));
		},
		function(jqXHR, textStatus, errorThrown) {
			var errordata = (jqXHR && jqXHR.responseJSON && jqXHR.responseJSON.error) || {
				'code': 'WEBSERVICE_ERROR',
				'message': 'Error contacting webservice: ' + textStatus + '; ' + errorThrown
			};

			var html = [];
			html.push('<div>',
				'<b>Could not retrieve concordances.</b><br>');

			if (jqXHR && jqXHR.status !== 0) // server is up
				html.push('This is usually due to a misconfigured server, see ',
					'<a href="https://github.com/INL/BlackLab/blob/be5b5be75c064e87cbfc2271fd19d073f80839af/core/src/site/markdown/blacklab-server-overview.md#installation" target="_blank">here</a> for more information.');

			html.push('<hr><b>', errordata.code, '</b><br>', errordata.message, '</div>');

			// TODO tidy up
			$button.parent().parent().html(html.join(''));
		});
	}

	/**
	 * Convert a blacklab-server reply containing information about hits into a table containing the results.
	 *
	 * @param {any} data the blacklab-server response.
	 * @returns An array of html strings containing the <thead> and <tbody>, but without the enclosing <table> element.
	 */
	function formatHits(data, textDirection) {
		// TODO use mustache.js

		var html = [];
		html.push(
			'<thead><tr>',
				'<th class="text-right" style="width:40px">',
					'<span class="dropdown">',
						'<a class="dropdown-toggle" data-toggle="dropdown">',
						textDirection=='ltr'? 'Before hit ' : 'After hit ',
						'<span class="caret"></span></a>',
						'<ul class="dropdown-menu" role="menu" aria-labelledby="left">');
						PROPS.all.forEach(function(prop) { html.push(
							'<li><a data-bls-sort="left:' + prop.id + '">' + prop.displayName + '</a></li>');
						});
						html.push(
						'</ul>',
					'</span>',
				'</th>',

				'<th class="text-center" style="width:20px;">',
					'<a data-bls-sort="hit:' + PROPS.firstMainProp.id + '"><strong>' + PROPS.firstMainProp.displayName + '<strong></a>',
				'</th>',

				'<th class="text-left" style="width:40px;">',
					'<span class="dropdown">', // Span as when it's div, and we're right aligning text, the dropdown doesn't align because the div extends all the way left
						'<a class="dropdown-toggle" data-toggle="dropdown">',
						textDirection=='ltr'? 'After hit ' : 'Before hit ',
						'<span class="caret"></span></a>',
						'<ul class="dropdown-menu" role="menu" aria-labelledby="right">');
						PROPS.all.forEach(function(prop) { html.push(
							'<li><a data-bls-sort="right:' + prop.id + '">' + prop.displayName + '</a></li>');
						});
						html.push(
						'</ul>',
					'</span>',
				'</th>');

			// Not all properties have their own table columns
			PROPS.shown.forEach(function(prop) { html.push(
				'<th style="width:15px;"><a data-bls-sort="hit:' + prop.id + '">' + prop.displayName + '</a></th>');
			});
		html.push('</tr></thead>');

		html.push('<tbody>');
		var prevHitDocPid = null;
		var numColumns = 3 + PROPS.shown.length; // before context - hit context - after context - remaining properties
		$.each(data.hits, function(index, hit) {
			// Render a row for this hit's document, if this hit didn't occurred in a new document
			var docPid = hit.docPid;
			if (docPid !== prevHitDocPid) {
				prevHitDocPid = docPid;
				var doc = data.docInfos[docPid];
				var docTitle = doc[data.summary.docFields.titleField] || 'UNKNOWN';
				var docAuthor = doc[data.summary.docFields.authorField] ? ' by ' + doc[data.summary.docFields.authorField] : '';
				var docDate = doc[data.summary.docFields.dateField] ? ' (' + doc[data.summary.docFields.dateField] + ')' : '';

				// TODO the clientside url generation story... https://github.com/INL/corpus-frontend/issues/95
				// Ideally use absolute urls everywhere, if the application needs to be proxied, let the proxy server handle it.
				// Have a configurable url in the backend that's made available on the client that we can use here.
				var docUrl;
				switch (new URI().filename()) {
					case '':
						docUrl = new URI('../../docs/'); 
						break;
					case 'docs':
					case 'hits':
						docUrl = new URI('../docs/');
						break;
					case 'search':
					default: // some weird proxy?
						docUrl = new URI('./docs/');
						break;
				}

				docUrl = docUrl
				.absoluteTo(new URI().toString())
				.filename(docPid)
				.search({
					'query': data.summary.searchParam.patt
				})
				.toString();

				// Display some info about the document
				html.push(
					'<tr>',
						'<td colspan="', numColumns, '"><div class="doctitle collapse in">',
							'<a class="text-error" target="_blank" href="', docUrl, '">', docTitle, docAuthor, docDate, '</a>',
						'</div></td>',
					'</tr>');
			}

			// And display the hit itself
			var parts = snippetParts(hit);
			var left = textDirection=='ltr'? parts[0] : parts[2];
			var right = textDirection=='ltr'? parts[2] : parts[0];
			var propsWord = properties(hit.match).replace("'","\\'").replace("&apos;","\\'").replace('"', '&quot;');

			html.push(
				'<tr class="concordance" onclick="SINGLEPAGE.INTERFACE.showCitation(this, \''
				+ docPid + '\', '+ hit.start + ', '+ hit.end + ', \'' + textDirection + '\');SINGLEPAGE.INTERFACE.showProperties(this, \''+propsWord+'\');">',
					'<td class="text-right">', ELLIPSIS, ' <span dir="', textDirection, '">', left, '</span></td>',
					'<td class="text-center"><span dir="', textDirection, '"><strong>', parts[1], '</strong></span></td>',
					'<td><span dir="', textDirection, '">', right, '</span> ', ELLIPSIS, '</td>');
					PROPS.shown.forEach(function(prop) { html.push(
						'<td>', words(hit.match, prop.id, false, ''), '</td>');
					});
					html.push(
				'</tr>');

			// Snippet row (initially hidden)
			html.push(
				'<tr>',
					'<td colspan="', numColumns, '" class="inline-concordance"><div class="collapse">Loading...</div></td>',
				'</tr>');
			// Properties row (initially hidden)
			html.push(
				'<tr>',
					'<td colspan="', numColumns, '" class="inline-concordance"><div class="collapse">Loading...</div></td>',
				'</tr>');
		});

		html.push('</tbody>');
		return html;
	}

	/**
	 * Convert a blacklab-server reply containing information about documents into a table containing the results.
	 *
	 * @param {any} data the blacklab-server response.
	 * @returns An array of html strings containing the <thead> and <tbody>, but without the enclosing <table> element.
	 */
	function formatDocs(data, textDirection) {
		var html = [];

		html.push(
			'<thead><tr>',
				'<th style="width:70%"><a data-bls-sort="field:', data.summary.docFields.titleField, '">Document title</a></th>',
				'<th style="width:15%"><a data-bls-sort="field:', data.summary.docFields.dateField, '">Year</a></th>',
				'<th style="width:15%"><a data-bls-sort="numhits">Hits</a></th>',
			'</tr></thead>'
		);

		html.push('<tbody>');
		$.each(data.docs, function(index, doc) {
			var docPid = doc.docPid;

			var docTitle = doc.docInfo[data.summary.docFields.titleField] || 'UNKNOWN';
			var docAuthor = doc.docInfo[data.summary.docFields.authorField] ? ' by ' + doc.docInfo[data.summary.docFields.authorField] : '';
			var docDate = doc.docInfo[data.summary.docFields.dateField] || '';
			var docHits = doc.numberOfHits || '';

			var snippetStrings = [];
			$.each(doc.snippets, function(index, snippet) {
				var parts = snippetParts(snippet);
				snippetStrings.push(ELLIPSIS, ' ', parts[0], '<strong>', parts[1], '</strong>', parts[2], ELLIPSIS);
				return false; // only need the first snippet for now
			});

			// TODO the clientside url generation story... https://github.com/INL/corpus-frontend/issues/95
			// Ideally use absolute urls everywhere, if the application needs to be proxied, let the proxy server handle it.
			// Have a configurable url in the backend that's made available on the client that we can use here.
			var docUrl;
			switch (new URI().filename()) {
				case '':
					docUrl = new URI('../../docs/'); 
					break;
				case 'docs':
				case 'hits':
					docUrl = new URI('../docs/');
					break;
				case 'search':
				default: // some weird proxy?
					docUrl = new URI('./docs/');
					break;
			}

			docUrl = docUrl
			.absoluteTo(new URI().toString())
			.filename(docPid)
			.search({
				'query': data.summary.searchParam.patt
			})
			.toString();

			html.push(
				'<tr class="documentrow">',
					'<td>',
						'<a target="_blank" href="', docUrl, '">', docTitle, docAuthor, '</a><br>', '<span dir="', textDirection, '">',
						snippetStrings.join(''), snippetStrings.length > 0 ? '<br>' : '', '</span>',
						'<a class="green btn btn-xs btn-default" target="_blank" href="', docUrl,'">View document info</a>',
					'</td>',
					'<td>', docDate, '</td>',
					'<td>', docHits, '</td>',
				'</tr>');
		});
		html.push('</tbody>');

		return html;
	}

	/**
	 * Convert a blacklab-server reply containing information about hit or document groups into a table containing the results.
	 * Some minor styling is applied based on whether the results are hits or documents.
	 *
	 * @param {any} data the blacklab-server response.
	 * @returns An array of html strings containing the <thead> and <tbody>, but without the enclosing <table> element.
	 */
	function formatGroups(data) {
		var html = [];

		html.push(
			'<thead><tr>',
				'<th style="width:30%;"><a data-bls-sort="identity">Group</a></th>',
				'<th style="width:70%;"><a data-bls-sort="numhits">Hits</a></th>',
			'</tr></thead>'
		);

		// give the display a different color based on whether we're showing hits or docs
		var displayClass = data.hitGroups ? 'progress-bar-success' : 'progress-bar-warning';
		var idPrefix = data.hitGroups ? 'hg' : 'dg'; // hitgroup : docgroup

		html.push('<tbody>');
		var groups = data.hitGroups || data.docGroups;
		$.each(groups, function(index, group) {
			var groupId = group.identity;
			var htmlId = idPrefix + index;

			var displayName = group.identityDisplay;
			var displayWidth = (group.size / data.summary.largestGroupSize) * 100;

			html.push(
				'<tr>',
					'<td>', displayName, '</td>',
					'<td>',
						'<div class="progress group-size-indicator" data-toggle="collapse" data-target="#', htmlId, '" style="cursor:pointer;">',
							'<div class="progress-bar ', displayClass, '" style="min-width: ', displayWidth, '%;">', group.size, '</div>',
						'</div>',
						'<div class="collapse inline-concordance" id="', htmlId, '">',
							'<div>',
								'<button type="button" class="btn btn-sm btn-link viewconcordances" data-group-name="', displayName, '" data-group-id="', groupId, '">&#171; View detailed concordances in this group</button> - ',
								'<button type="button" class="btn btn-sm btn-link loadconcordances" data-group-id="', groupId, '">Load more concordances...</button>',
							'</div>',
						'</div>',
					'</td>',
				'</tr>');
		});
		html.push('</tbody>');

		return html;
	}

	/**
	 * Request the currently shown results as a CSV file, and save it.
	 *
	 * 'this' should be the tab containing the results to export.
	 * 'event.target' should be the element that was clicked.
	 *
	 * @param {Jquery.Event} event
	 */
	function onExportCsv(event) {
		var $tab = $(event.delegateTarget);

		var $button = $(event.target);
		if ($button.hasClass('disabled'))
			return;

		var pageParam = $.extend({},
			$tab.data('defaultParameters'),
			$tab.data('parameters'),
			$tab.data('constParameters'));

		var blsParam = SINGLEPAGE.BLS.getBlsParam(pageParam);

		blsParam.outputformat = 'csv';
		delete blsParam.number;
		delete blsParam.first;

		var url = new URI(BLS_URL).segment(pageParam.operation).addSearch(blsParam).toString();
		if (SINGLEPAGE.DEBUG) {
			console.log('CSV download url', url, blsParam);
		}

		$button
			.addClass('disabled')
			.attr('disabled', true)
			.prepend('<span class="fa fa-spinner fa-spin"></span>');
		$.ajax(url, {
			accepts: 'application/csv',
			cache: 'false',
			data: 'text',
			error: function(jqXHR, textStatus, errorThrown) {

			},
			success: function(data) {
				var b = new Blob([data], { type: 'application/csv' });
				saveAs(b, 'data.csv'); // FileSaver.js
			},
			complete: function() {
				$button
					.removeClass('disabled')
					.attr('disabled', false)
					.find('.fa-spinner').remove();
			}
		});
	}

	/**
	 * Redraws the table, pagination, hides spinners, shows/hides group indicator, shows the pagination/group controls, etc.
	 *
	 * @param {any} data the successful blacklab-server reply.
	 */
	function setTabResults(data) {
		var $tab = $(this);
		var html;
		var textDirection = SINGLEPAGE.INDEX.textDirection || 'ltr';
		// create the table
		if (data.hits && data.hits.length)
			html = formatHits(data, textDirection);
		else if (data.docs && data.docs.length)
			html = formatDocs(data, textDirection);
		else if ((data.hitGroups && data.hitGroups.length) || (data.docGroups && data.docGroups.length))
			html = formatGroups(data);
		else {
			html = [
				'<thead>',
					'<tr><th><a>No results found</a></th></tr>',
				'</thead>',
				'<tbody>',
					'<tr>',
						'<td class="no-results-found">No results were found. Please check your query and try again.</td>',
					'</tr>',
				'</tbody>'
			];
		}

		function onTableContentsReplaced() {
			// first time opening the concordances for a group, load the first results
			$(this).find('.collapse').one('show.bs.collapse', function() {
				$(this).find('.loadconcordances').click();
			});
			$(this).find('.loadconcordances').on('click', loadConcordances);
			$(this).find('.viewconcordances').on('click', viewConcordances);
		}

		// Always do this, if an out-of-bounds request is made and no data is returned,
		// the pagination will still be accurate, allowing the user to go back to a valid page.
		updatePagination($tab.find('.pagination'), data);
		replaceTableContent($tab.find('.resultcontainer table'), html.join(''), onTableContentsReplaced);
		hideSearchIndicator($tab);
		$tab.find('.resultcontrols, .resultcontainer').show();
		$tab.data('results', data);

		// Hide/show the group view identifier and reset button
		// The values of these are set when the search is initiated in viewConcordances()
		// TODO when blacklab-server echoes the friendly name of the group, display that here and don't set any data
		// when initiating the search
		// TODO we set the value as fallback when no value currently set, as when first loading page, there was no initial search
		// where we know the group parameter.
		var $resultgroupdetails = $tab.find('.resultgroupdetails');
		if (data.summary.searchParam.viewgroup) {
			$resultgroupdetails.show();
			var $resultgroupname = $resultgroupdetails.find('.resultgroupname');
			if (!$resultgroupname.text())
				$resultgroupname.text(data.summary.searchParam.viewgroup);
		} else {
			$resultgroupdetails.hide();
		}

		var showWarning = !!(data.summary.stoppedRetrievingHits && !data.summary.stillCounting);
		$tab.find('.results-incomplete-warning').toggle(showWarning);
	}

	/**
	 * Clears displayed data, hides pagination, group indicator, group control, cached results, etc.
	 *
	 * @param {any} $tab
	 */
	function clearTabResults($tab) {
		$tab.find('.resultcontrols').hide();
		$tab.find('.resultcontainer').hide().find('table thead, table tbody').empty();
		$tab.find('.resultgroupdetails .resultgroupname').empty();
		$tab.removeData('results');
	}

	/**
	 * Set new search parameters for this tab. Does not mark tab for refresh or remove existing data.
	 *
	 * NOTE: pagination is never updated based on parameters, but instead drawn based on search response.
	 * @param {jquery} $tab - tab-pane containing all contents of tab
	 * @param {any} newParameters - object containing any updated parameter keys
	 * @param {boolean} [toPageState = false] whether to copy the parameter values to their ui elements
	 */
	function setTabParameters($tab, newParameters, toPageState) {

		// make a copy of the new parameters without groupBy and viewGroup if the parameters were meant for
		// a tab with a different operation
		if (newParameters.operation != null && newParameters.operation !== $tab.data('parameters').operation) {
			newParameters = $.extend({}, newParameters);
			// undefined so we don't overwrite our existing parameters
			newParameters.groupBy = undefined;
			newParameters.viewGroup = undefined;
		}

		// write new values while preserving original values
		var updatedParameters = $.extend($tab.data('parameters'), newParameters, $tab.data('constParameters'));

		// copy parameter values to their selectors etc
		if (toPageState) {
			var $groupSelect = $tab.find('select.groupselect');

			if ($groupSelect.length)
				$groupSelect.selectpicker('val', updatedParameters.groupBy);
		}
	}

	/**
	 * Updates the internal parameters for a tab and executes a search if the tab is currently active.
	 *
	 * Any currently shown results are not cleared.
	 * Automatically unhides results containers and controls once search completes.
	 *
	 * @param {any} event where the data attribute holds all new parameters
	 */
	function onLocalParameterChange(event, parameters) {
		var $tab = $(this);

		setTabParameters($tab, parameters, true);
		$tab.removeData('results'); // Invalidate data to indicate a refresh is required

		if ($tab.hasClass('active')) // Emulate a reopen of the tab to refresh it
			$tab.trigger('tabOpen');
	}

	/**
	 * The core search trigger, named a little awkwardly because it autotriggers when a tab is made active/opens.
	 * We emulate the tab reopening to update the displayed search results when new search parameters are set/selected.
	 */
	function onTabOpen(/*event, data*/) {

		var $tab = $(this);
		var searchSettings = $.extend({}, $tab.data('defaultParameters'), $tab.data('parameters'), $tab.data('constParameters'));

		// CORE does as little UI manipulation as possible, just shows a tab when required
		// so we're responsible for showing the entire results area.
		$('#results').show();
		var querySummary = SINGLEPAGE.BLS.getQuerySummary(searchSettings.pattern, searchSettings.within, searchSettings.filters);
		$('#searchFormDivHeader').show()
		.find('#querySummary').text(querySummary).attr('title', querySummary.substr(0, 1000));

		if ($tab.data('results')) {
			// Nothing to do, tab is already displaying data (this happens when you go back and forth between tabs without changing your query in between)
			// Still notify core so that when the url is copied out the current tab can be restored.
			SINGLEPAGE.CORE.onSearchUpdated(searchSettings);
			return;
		}

		// Not all configurations of search parameters will result in a valid search
		// Verify that we're not trying to view hits without a pattern to generate said hits
		// and warn the user if we are
		if (searchSettings.operation === 'hits' && (searchSettings.pattern == null || searchSettings.pattern.length === 0)) {
			replaceTableContent($tab.find('.resultcontainer table'),
				['<thead>',
					'<tr><th><a>No hits to display</a></th></tr>',
				'</thead>',
				'<tbody>',
					'<tr>',
						'<td class="no-results-found">No hits to display... (one or more of Lemma/PoS/Word is required).</td>',
					'</tr>',
				'</tbody>'
				].join('')
			);
			$tab.find('.resultcontainer').show();
			$tab.find('.resultcontrols').hide();
			$tab.data('results', {}); // Prevent refreshing search on next tab open
			return;
		}

		// All is well, search!
		showSearchIndicator($tab);
		SINGLEPAGE.CORE.onSearchUpdated(searchSettings);
		SINGLEPAGE.BLS.search(searchSettings,
			function onSuccess() {
				hideBlsError();
				$tab.data('fnSetResults').apply(undefined, Array.prototype.slice.call(arguments)); // call with original args
			},
			function onError() {
				hideSearchIndicator($tab);
				showBlsError.apply(undefined, Array.prototype.slice.call(arguments)); // call with original args
			}
		);
	}

	return {
		init: function() {
			// Hide the results area and deactivate all tabs to prevent accidental refreshes later.
			// Tabs are unhidden when a search is submitted.
			$('#results').hide();
			$('#resultTabs a').each(function() { $(this).tab('hide'); });
			$('.searchIndicator').hide();

			// See parameters type documentation in singlepage-bls.js
			$('#tabHits')
				.data('parameters', {})
				.data('defaultParameters', {
					page: 0,
					pageSize: 50,
					sampleMode: null,
					sampleSize: null,
					sampleSeed: null,
					pattern: null,
					within: null,
					filters: null,
					sort: null,
					groupBy: null,
					viewGroup: null,
				})
				.data('constParameters', {
					operation: 'hits',
				})
				.data('fnSetResults', setTabResults.bind($('#tabHits')[0]));

			$('#tabDocs')
				.data('parameters', {})
				.data('defaultParameters', {
					page: 0,
					pageSize: 50,
					sampleMode: null,
					sampleSize: null,
					sampleSeed: null,
					pattern: null,
					within: null,
					filters: null,
					sort: null,
					groupBy: null,
					viewGroup: null,
				})
				.data('constParameters', {
					operation: 'docs',
				})
				.data('fnSetResults', setTabResults.bind($('#tabDocs')[0]));

			$('#resultTabsContent .tab-pane').on('localParameterChange', onLocalParameterChange);
			$('#resultTabsContent .tab-pane').on('tabOpen', onTabOpen);
			$('#resultTabsContent .tab-pane').on('click', '.exportcsv', onExportCsv);

			// Forward show/open event to tab content pane
			$('#resultTabs a').on('show.bs.tab', function() {
				$($(this).attr('href')).trigger('tabOpen');
			});

			// use indirect event capture for easy access to the tab content-pane
			$('#resultTabsContent .tab-pane')
				.on('click', '[data-bls-sort]', function(event) {
					var sort = $(this).data('blsSort');
					var invert = ($(event.delegateTarget).data('parameters').sort === sort);

					$(this).trigger('localParameterChange', {
						sort: invert ? '-' + sort : sort
					});
					event.preventDefault();
				})
				.on('click', '[data-page]', function(event) {
					$(this).trigger('localParameterChange', {
						page: $(this).data('page')
					});
					event.preventDefault();
				})
				// don't attach to 'changed', as that fires every time a single option is toggled, instead wait for the menu to close
				.on('hide.bs.select', 'select.groupselect', function(event) {
					var prev = $(event.delegateTarget).data('parameters').groupBy || [];
					var cur = $(this).selectpicker('val') || [];
					// Don't fire search if options didn't change
					
					if (prev.length != cur.length || !prev.every(function(elem) { return cur.includes(elem); })) {
						$(this).trigger('localParameterChange', {
							groupBy: cur,
							page: 0,
							viewGroup: null, // Clear any group we may be currently viewing, as the available groups just changed
						});
					}

					event.preventDefault();
				})
				.on('click', '.clearviewgroup', function(event) {
					$(this).trigger('localParameterChange', {
						page: 0,
						viewGroup: null,
					});
					event.preventDefault();
				});
		},

		showCitation: showCitation,
		showProperties: showProperties,

		/**
		 * Set new search parameters and mark tabs for a refresh of data.
		 *
		 * The currently shown tab will auto-refresh.
		 * Parameters with corresponding UI-elements within the tabs will update those elements with the new data.
		 * NOTE: pagination is never updated based on parameters, but instead drawn based on search response.
		 * @param {any} searchParameters New search parameters.
		 * @param {boolean} [clearResults=false] Clear any currently displayed search results.
		 */
		setParameters: function(searchParameters, clearResults) {
			$('#resultTabsContent .tab-pane').each(function() {
				var $tab = $(this);
				if (clearResults)
					clearTabResults($tab);

				$tab.trigger('localParameterChange', searchParameters);
			});
		},

		/**
		 * Clear all results, hide the result area and reset all search parameters within the tabs.
		 *
		 * Deactivates all tabs and hides the result area.
		 */
		reset: function() {
			// Hide the results area and deactivate all tabs to prevent accidental refreshes later (search is executed when tab is opened (if search parameters are valid))
			$('#results').hide();
			$('#resultTabs a').each(function() { $(this).tab('hide'); });

			$('#searchFormDivHeader').hide();

			$('#resultTabsContent .tab-pane').each(function() {
				var $tab = $(this);

				clearTabResults($tab);
				$tab.trigger('localParameterChange', $.extend({},
					$tab.data('defaultParameters'),
					$tab.data('constParameters')
				));
			});
		}
	};
})();
