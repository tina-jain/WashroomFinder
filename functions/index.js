'use strict';

process.env.DEBUG = 'actions-on-google:*';
const App = require('actions-on-google').DialogflowApp;
const functions = require('firebase-functions');
const admin = require('firebase-admin');

const CHECK_PERMISSIONS_ACTION = 'check.permissions';
const HANDLE_PERMISSIONS_ACTION = 'handle.permissions';
const SEARCH_WASHROOM_ACTION = 'search.washrooms';
const PROPERTY_MARKETING_ACTION = 'property.marketing';
const PROPERTY_NAVIGATE_ACTION = 'property.navigate';

const PROP_CONTEXT = 'property.context';
const NAME_ARGUMENT = 'property.name';
const ADDRESS_ARGUMENT = 'property.address';

admin.initializeApp(functions.config().firebase);

exports.washRoomFinder = functions.https.onRequest((request, response) => {
  const app = new App({request, response});
  console.log('Request headers: ' + JSON.stringify(request.headers));
  console.log('Request body: ' + JSON.stringify(request.body));

  function checkPermissions (app) {
  	let namePermission = app.SupportedPermissions.NAME;
	let preciseLocationPermission = app.SupportedPermissions.DEVICE_PRECISE_LOCATION;

	// Ask for permissions. User can authorize all or none.
	app.askForPermissions('To address you by name and know your location',
		[namePermission, preciseLocationPermission]);
  }
  
  function handlePermissions (app) {
	  if (app.isPermissionGranted()) {
			app.userStorage.location = app.getDeviceLocation()
			app.userStorage.name = app.getUserName().displayName;
			
			app.ask('Thank you for granting the permissions.');
        } else {
            app.tell('Unauthorized');
        }
  }
  
  function searchWashrooms (app) {
  	var list = app.buildList('Washrooms nearby')
	
	var db = admin.database();
	db.ref('/properties').once('value').then(function(snapshot) {
		
		snapshot.forEach(function (snap) {
			var key = snap.key;
			var item = snap.val();
			list.addItems(app.buildOptionItem(key, [item.name])
									.setTitle(item.name)
									.setDescription(item.address)
									.setImage(item.imageUrl, item.name)
						 )			
		});
		
		app.askWithList('Here are a few places nearby. Which sounds better?', list);
		return null;
		}).catch(error => {
		console.error(error);
		return null;
	});
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
		
		var userLocation = {
			latitude: 18.533876,
			longitude: 73.827662
		};
		
		var coordinates = selectedProperty.coordinates;
		
		app.ask(app.buildRichResponse()
		.addSimpleResponse(selectedProperty.name)
		.addBasicCard(app.buildBasicCard(selectedProperty.marketing)
						  .setTitle(selectedProperty.name)
						  .addButton('Review', 'http://www.washroom-portal/review/' + selectedPropertyId)
						  .setImage(selectedProperty.imageUrl, selectedProperty.name)
						  .setImageDisplay('CROPPED')
			)
		);
		
		//app.ask(selectedProperty.name + ' is an excellent choice. ' + selectedProperty.marketing +' Please leave us a review about washroom at ' + param + '. Would you like me to navigate you?');
		
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