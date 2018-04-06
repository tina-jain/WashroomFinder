'use strict';

process.env.DEBUG = 'actions-on-google:*';
const App = require('actions-on-google').DialogflowApp;
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const distanceApi = require('google-distance-matrix');
const Responses = require('actions-on-google').Responses;
const { RichResponse, BasicCard } = Responses;

const CHECK_PERMISSIONS_ACTION = 'check.permissions';
const HANDLE_PERMISSIONS_ACTION = 'handle.permissions';
const SEARCH_WASHROOM_ACTION = 'search.washrooms';
const PROPERTY_MARKETING_ACTION = 'property.marketing';
const PROPERTY_REVIEW_ACTION = 'property.review';

//ARGUMENTS
const FILTER_ARGUMENT = 'washroom-filters';
const PAYMENT_ARGUMENT = 'washroom-payment-type';

// MAP Integration - Start
const url = require('url');
const config = functions.config();
const STATIC_MAPS_ADDRESS = 'https://maps.googleapis.com/maps/api/staticmap';
const STATIC_MAPS_SIZE = '600x400';
const STATIC_MAPS_TYPE = 'roadmap';
const staticMapsURL = url.parse(STATIC_MAPS_ADDRESS);

staticMapsURL.query = {
    key: config.maps.key,
    size: STATIC_MAPS_SIZE,
    maptype: STATIC_MAPS_TYPE,
	zoom: 14
  };
//END

distanceApi.key('AIzaSyCFaspOuiFvWc49Ex40Rgs9cAZs5FQS-TU');
distanceApi.mode('walking');

admin.initializeApp(functions.config().firebase);

exports.freshroomsApi = functions.https.onRequest((request, response) => {
  const app = new App({request, response});
  let userStorage = app.userStorage;

  console.log('Request headers: ' + JSON.stringify(request.headers));
  console.log('Request body: ' + JSON.stringify(request.body));

  function checkPermissions (app) {
	app.askForPermission('To address you by name and know your location',
	app.SupportedPermissions.DEVICE_PRECISE_LOCATION);
  }

  function handlePermissions (app) {
	  if (app.isPermissionGranted()) {
			userStorage.location = app.getDeviceLocation().coordinates;
			app.ask('Thank you for granting the permissions.');
        } else {
            app.tell('Unauthorized');
        }
  }

  function calcDistance(lat1, lon1, lat2, lon2) {
   var piValue = 0.017453292519943295;    // Math.PI / 180
   var dist = 0.5 - Math.cos((lat2 - lat1) * piValue)/2 +
           Math.cos(lat1 * piValue) * Math.cos(lat2 * piValue) *
           (1 - Math.cos((lon2 - lon1) * piValue))/2;

   return 12742 * Math.asin(Math.sqrt(dist)); // 2  R; R = 6371 km
}

  function propertyComparator(first, second) {
	return first.distance - second.distance;
 }

  function searchWashrooms (app) {
  	var list = app.buildList('Washrooms nearby')

		var filter = app.getArgument(FILTER_ARGUMENT);
		var paymentFilter = app.getArgument(PAYMENT_ARGUMENT);

	var properties = [];
	var destinations = [];
	var db = admin.database();
	var maplink = '';
	db.ref('/properties').once('value').then(function(snapshot) {

		snapshot.forEach(function (snap) {
			var key = snap.key;
			var item = snap.val();

			item.key = key;

			var keywords = item.keywords.split(',');

			if(filter)
				console.log('Filter KEYWORD found: ' + filter );
			if(paymentFilter)
					console.log('Filter PAYMENT_FILTER found: ' + paymentFilter);

			var passesFilter = true;

			if (paymentFilter){
				console.log('payment Filter found' + paymentFilter );
				if(item.payment.paymentType !== paymentFilter)
					passesFilter = false;
				else
					console.log('found required ' + paymentFilter + ' in item ' + item.name );
			}

			if (filter){
				console.log('Filter KEYWORD found' + filter );
				if(item.keywords.indexOf(filter) < 0)
					passesFilter = false;
				else
					console.log('Found ' + filter + ' KEYWORD in item ' + item.name );
			}

			if(passesFilter){
				properties.push(item);
				destinations.push(item.coordinates.latitude + ',' + item.coordinates.longitude);
			}
		});

		if(properties.length === 0)
			return app.ask('No washrooms found with given perferences. Please try again with different preferences');

		var origins = [userStorage.location.latitude + ',' + userStorage.location.longitude];
		distanceApi.matrix(origins, destinations, function (err, distances) {
			console.log("DistanceCal: response start");
			if (err) {
				console.log("DistanceCal: error");
				return;
			}
			if(!distances) {
				console.log("DistanceCal: Nothing");
				return;
			}
			if (distances.status === 'OK') {
				var origin = distances.origin_addresses[0];
				for (var j = 0; j < destinations.length; j++) {
					var destination = distances.destination_addresses[j];
					if (distances.rows[0].elements[j].status === 'OK') {
						properties[j].distance = distances.rows[0].elements[j].distance.value / 1000;
						properties[j].distanceText = distances.rows[0].elements[j].distance.text;
						console.log('DistanceCal: Distance from ' + origin + ' to ' + destination + ' is ' + properties[j].distanceText);
					} else {
						console.log('DistanceCal: ' + destination + ' is not reachable by land from ' + origin);
					}
				}

				if(properties.length === 1) {
                    var item = properties[0];

                    userStorage.selectedProperty = { id: item.key, name: item.name };

                    console.log('Selected: ' + item.name);
                    var coordinates = item.coordinates;

				    app.ask(app.buildRichResponse()
                        .addSimpleResponse(item.name)
                        .addBasicCard(app.buildBasicCard(item.address + ' - ' + item.distanceText + '. ' + item.marketing)
                            .setTitle(item.name)
				            .addButton('Navigate Me', 'https://www.google.com/maps/dir/?api=1&origin=' + userStorage.location.latitude + ',' + userStorage.location.longitude + '&destination=' + coordinates.latitude + ',' + coordinates.longitude + '&travelmode=walking')
                            .setImage(item.imageUrl, item.name)
				            .setImageDisplay('CROPPED')
						)
					);
				}
				else {
					properties.sort(propertyComparator).slice(0, 3).forEach(function(item) {
					var description = item.address + ' - ' + item.distanceText;
					list.addItems(app.buildOptionItem(item.key, [item.name])
											.setTitle(item.name)
											.setDescription(description)
											.setImage(item.imageUrl, item.name)
								 );
					maplink = maplink + '&markers=color:red%7Clabel:S%7C' + item.coordinates.latitude + ',' + item.coordinates.longitude;
					});
					app.askWithList(pinLocationMarkersResponse(maplink), list);
				}
			}
		});

		return null;
		}).catch(error => {
		console.error(error);
		return null;
	});
  }

  function pinLocationMarkersResponse(maplink) {
		let userLatitude = userStorage.location.latitude;
		let userLongitude = userStorage.location.longitude;

		maplink = maplink + '&markers=color:blue%7Clabel:S%7C' + userLatitude + ',' + userLongitude;

		staticMapsURL.query.center = userLatitude + ',' + userLongitude;

		const mapViewURL = url.format(staticMapsURL);

		return new RichResponse().addSimpleResponse('Here are a few places nearby. Which sounds better?')
				.addSuggestionLink('Locations in Map', mapViewURL + maplink)
   }

  function propertyMarketing (app) {
   const selectedPropertyId = app.getSelectedOption();
   
   var db = admin.database();
   db.ref('/properties/' + selectedPropertyId).once('value').then(function(snapshot) {
	   var selectedProperty = snapshot.val();
	   
		userStorage.selectedProperty = {id: selectedPropertyId, name: selectedProperty.name};
	   
		console.log('Selected: ' + selectedProperty.name);
		var coordinates = selectedProperty.coordinates;

		app.ask(app.buildRichResponse()
		.addSimpleResponse(selectedProperty.name)
		.addBasicCard(app.buildBasicCard(selectedProperty.marketing)
						  .setTitle(selectedProperty.name)
						  .addButton('Navigate Me', 'https://www.google.com/maps/dir/?api=1&origin=' + userStorage.location.latitude + ',' + userStorage.location.longitude +'&destination=' + coordinates.latitude + ',' + coordinates.longitude + '&travelmode=walking')
						  .setImage(selectedProperty.imageUrl, selectedProperty.name)
						  .setImageDisplay('CROPPED')
			)
		);
		return null;
		}).catch(error => {
		console.error(error);
		return null;
	});
  }

  function propertyReview (app) {
	  if(userStorage.selectedProperty) {
		console.log(userStorage.selectedProperty.id);
		app.tell(app.buildRichResponse()
		.addSimpleResponse(userStorage.selectedProperty.name)
		.addBasicCard(app.buildBasicCard('Please give your valuable feedback to help us serve you better')
						  .setTitle(userStorage.selectedProperty.name)
						  .addButton('Review', 'https://washroomfinder-80159.firebaseapp.com/review.html?property=' + userStorage.selectedProperty.id)
			)
		);
	  }
  }

  // d. build an action map, which maps intent names to functions
  let actionMap = new Map();
  actionMap.set(CHECK_PERMISSIONS_ACTION, checkPermissions);
  actionMap.set(HANDLE_PERMISSIONS_ACTION, handlePermissions);
  actionMap.set(SEARCH_WASHROOM_ACTION, searchWashrooms);
  actionMap.set(PROPERTY_MARKETING_ACTION, propertyMarketing);
  actionMap.set(PROPERTY_REVIEW_ACTION, propertyReview);

  app.handleRequest(actionMap);
});
