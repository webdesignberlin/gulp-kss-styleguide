var Promise = require('promise');
var through = require('through2'); // https://www.npmjs.org/package/through2
var es = require('event-stream');
var extend = require('extend'); // https://www.npmjs.org/package/extend
var gutil = require('gulp-util'); // https://www.npmjs.org/package/gulp-util
var kss = require('kss');

var generateSectionMap = require('./lib/generate-section-map');

// consts
const PLUGIN_NAME = 'gulp-kss-styleguide';



// Usage:
// Pass in all of your styles (CSS, Sass, Less)
//	gulp.src('./css/**/*').pipe(kssStyleguide());
// 
// To generate a styleguide, use the `sectionBuildCallback` option. 
// `sectionBuildCallback` will be called for each root section with the appropriate context
// gulp.src('./css/**/*').pipe(kssStyleguide({
//	sectionBuildCallback: function(context) {
//		return gulp.src('./template/path')
//			.pipe(renderTemplate(context));
//	}
// }));
//
//
// Context:
// var context = {
//	kssMap: sectionMap,
//	currentRootReference: number
// };
// The sectionMap consists of many sections and many modifiers per section:
//	sectionMap = {
//		sections: [
//			{
//				refence,
//				header,
//				description,
//				isDeprecated,
//				isExperimental,
//				markup,
//				modifiers: [
//					{
//						name,
//						description,
//						markup
//					}
//				]
//			}
//		]
//	}
//



function mergeStreamsInto(parentStream, streams)
{
	var resultantStream = null;
	// You can pass an array of streams.
	// If they only return a single stream, then turn it into a array
	var streamList = streams instanceof Array ? streams : [streams];
	streamList.forEach(function(currentStream) {
		// Merge the streams, if there is already one
		if(parentStream) {
			resultantStream = es.merge(parentStream, currentStream);
		}
		else {
			resultantStream = currentStream;
		}
	});

	return resultantStream;
}

var kss_styleguide = function(options) {

	// Supports all of the normal node KSS options: https://github.com/kss-node/kss-node/wiki/Module-API#options
	var defaults = {
		markdown: true,
		// Callback used to build/compile the section
		// Parameters: sectionContext
		// Return: stream or array of streams
		sectionBuildCallback: null,
		allSectionsBuiltCallback: null
	};

	var settings = extend({}, defaults, options);

	var bufferedContents = [];
	var stream = through.obj(function(chunk, enc, cb) {
		// http://nodejs.org/docs/latest/api/stream.html#stream_transform_transform_chunk_encoding_callback
		//console.log('transform');

		if (chunk.isStream()) {
			self.emit('error', new gutil.PluginError(PLUGIN_NAME, 'Cannot operate on stream'));
		}

		if (chunk.isBuffer()) {
			var contents = String(chunk.contents);
			bufferedContents.push(String(contents));
		}

		this.push(chunk);
		return cb();
	}, function(cb) {
		// http://nodejs.org/docs/latest/api/stream.html#stream_transform_flush_callback
		//console.log('flush');
		
		kss.parse(bufferedContents, settings, function(err, styleguide) {
			
			var sectionMap = generateSectionMap(styleguide);

			var context = {
				kssMap: sectionMap
			};

			var whenBuildDealtWithPromise = new Promise(function(buildResolve) {

				var sectionBuildsStream = null;
				if(settings.sectionBuildCallback) {
					Object.keys(sectionMap).forEach(function(reference) {
						var sectionContext = extend({}, context, {
							currentRootReference: reference
						});

						var returnedStreams = settings.sectionBuildCallback(sectionContext);
						sectionBuildsStream = mergeStreamsInto(sectionBuildsStream, returnedStreams);
					});
				}


				var whenSectionBuildsDealtWithPromise = new Promise(function(sectionBuildsResolve) {
					if(sectionBuildsStream) {
						// Once all of the streams from building the sections have finished,
						sectionBuildsStream.on('end', function() {
							sectionBuildsResolve();
						});
					}
					else {
						sectionBuildsResolve();
					}
				});


				var whenFinalBuildDealtWithPromise = new Promise(function(finalBuildsResolve) {
					// All of the sections are built(dealt with), so we now we do the final `settings.allSectionsBuiltCallback` callback
					whenSectionBuildsDealtWithPromise.done(function() {
						if(settings.allSectionsBuiltCallback) {
							// Make one last callback so that they can move assets, etc
							var returnedStreams = settings.allSectionsBuiltCallback(context);
							if(returnedStreams) {
								var mergedStream = mergeStreamsInto(null, returnedStreams);

								// We can consider the plugin, as a whole, to be completed
								mergedStream.on('end', function() {
									finalBuildsResolve();
								});
							}
							else {
								finalBuildsResolve();
							}
						}
						else {
							finalBuildsResolve();
						}
					});
				});



				// We dealt with all of the callbacks now
				whenFinalBuildDealtWithPromise.done(function() {
					buildResolve();
				});

			});


			whenBuildDealtWithPromise.done(function() {
				// "call callback when the flush operation is complete."
				cb();
			});


			/* * /
			sections.forEach(function(section) {
				console.log(section.reference(), "-", section.header());

				var modifiers = section.modifiers();
				modifiers.forEach(function(modifier) {
					console.log('\t', modifier.name());
					console.log('\t', modifier.markup());
				});
			});
			/* */
		});


	

	});

	// returning the file stream
	return stream;
};


module.exports = kss_styleguide;