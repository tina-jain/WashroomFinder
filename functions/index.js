'use strict';

process.env.DEBUG = 'actions-on-google:*';
const App = require('actions-on-google').DialogflowApp;
const functions = require('firebase-functions');
const admin = require('firebase-admin');

const Responses = require('actions-on-google').Responses;
const { RichResponse, BasicCard } = Responses;

const CHECK_PERMISSIONS_ACTION = 'check.permissions';
const HANDLE_PERMISSIONS_ACTION = 'handle.permissions';
const SEARCH_WASHROOM_ACTION = 'search.washrooms';
const PROPERTY_MARKETING_ACTION = 'property.marketing';
const PROPERTY_NAVIGATE_ACTION = 'property.navigate';

const PROP_CONTEXT = 'property.context';
const NAME_ARGUMENT = 'property.name';
const ADDRESS_ARGUMENT = 'property.address';

const USER_CONTEXT = 'user.context';
const LATITUDE_ARGUMENT = 'user.latitude';
const LONGITUDE_ARGUMENT = 'user.longitude';

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

admin.initializeApp(functions.config().firebase);

exports.washRoomFinder = functions.https.onRequest((request, response) => {
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
  
  function distance(lat1, lon1, lat2, lon2) {
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
	
	var properties = [];
	var db = admin.database();
	var maplink = '';
	db.ref('/properties').once('value').then(function(snapshot) {
		
		snapshot.forEach(function (snap) {
			var key = snap.key;
			var item = snap.val();
			
			item.key = key;
			item.distance = distance(userStorage.location.latitude, userStorage.location.longitude, item.coordinates.latitude, item.coordinates.longitude);
			properties.push(item);
			
			console.log(item.name + ' - ' + item.distance);
		});
		
		properties.sort(propertyComparator).slice(0, 3).forEach(function(item) {
			var description = item.address + ' - ' + Math.round(item.distance, 2) + ' km';
			list.addItems(app.buildOptionItem(item.key, [item.name])
									.setTitle(item.name)
									.setDescription(description)
									.setImage(item.imageUrl, item.name)
						 );
			maplink = maplink + '&markers=color:red%7Clabel:S%7C' + item.coordinates.latitude + ',' + item.coordinates.longitude;
		});
		
		app.askWithList(pinLocationMarkersResponse(maplink), list);
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
		console.log('Selected: ' + selectedProperty.name);
		
		const parameters = {};
		parameters[NAME_ARGUMENT] = selectedProperty.name;
		parameters[ADDRESS_ARGUMENT] = selectedProperty.address;
		
		app.setContext(PROP_CONTEXT, 1, parameters);
			
		var coordinates = selectedProperty.coordinates;
		
		app.ask(app.buildRichResponse()
		.addSimpleResponse(selectedProperty.name)
		.addSuggestionLink('Navigate', 'https://www.google.com/maps/dir/?api=1&origin=' + userStorage.location.latitude + ',' + userStorage.location.longitude +'&destination=' + coordinates.latitude + ',' + coordinates.longitude + '&travelmode=walking')
		.addBasicCard(app.buildBasicCard(selectedProperty.marketing)
						  .setTitle(selectedProperty.name)
						  .addButton('Review', 'http://www.washroom-portal/review/' + selectedPropertyId)
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
  
  function propertyNavigate (app) {
	let address = app.getContextArgument(PROP_CONTEXT, ADDRESS_ARGUMENT).value;
	console.log(address);
  	app.tell('Sorry propertyNavigate is not implemented');
  }
  
  // d. build an action map, which maps intent names to functions
  let actionMap = new Map();
  actionMap.set(CHECK_PERMISSIONS_ACTION, checkPermissions);
  actionMap.set(HANDLE_PERMISSIONS_ACTION, handlePermissions);
  actionMap.set(SEARCH_WASHROOM_ACTION, searchWashrooms);
  actionMap.set(PROPERTY_MARKETING_ACTION, propertyMarketing);
  actionMap.set(PROPERTY_NAVIGATE_ACTION, propertyNavigate);
  
  app.handleRequest(actionMap);
});