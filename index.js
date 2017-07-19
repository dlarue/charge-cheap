const https = require("https")
const Encryption = require('./encryption.js')

const moment = require('moment')
const nordpool = require('nordpool')
const prices = new nordpool.Prices()

require('dotenv').config()

let q, sessionid, vin

const today = moment().format("YYYY-MM-DD")
const tomorrow = moment().add(1,"d").format("YYYY-MM-DD")

getPrices("latest", (allPrices) => {

    console.log("Check if you've got tomorrows prices")
    if (moment(allPrices[0].date).format("YYYY-MM-DD") == tomorrow) {
        
        console.log("Todays prices are missing")
        getPrices(today, (todayPrices) => {
            allPrices.concat(todayPrices)
            console.log("Adding todays prices")
        })
    }

    console.log("All received prices:")
    console.log(allPrices)

    allPrices = removeUntilNow(allPrices)
    console.log("After removal of old prices:")
    console.log(allPrices)

    allPrices = removeAfter("0700", allPrices)
    console.log("All prices until 7 am:")
    console.log(allPrices)

    if (allPrices.length == 0) {
        console.log("No prices yet, check again in the afternoon")
    }

	console.log("Finding out how many hours of chargeing is needed")
	hoursNeeded = hoursNeeded()

    if (hoursNeeded > allPrices.length) {
        console.log("Not enough hours for a full charge tonight")
        chargeNow()
    } else {
        if (timeIsNow(allPrices, hoursNeeded)) {
            console.log("Now is a good time to start chargeing")
            chargeNow()
        }        
    }
})


function getPrices(to, _callback) {
    let arr = new Array()

    if (to == "latest") {
        options = {
            area: 'SE3',
            currency: 'EUR'
        }
        console.log("Get latest prices")
    } else {
        options = {
            area: 'SE3',
            currency: 'EUR',
            to: to
        }
        console.log("Get prices for " + to )
    }

    prices.hourly(options, (error, results) => {
		if (error) console.err(error)

		for (let i=0; i<results.length; i++) {
			arr.push({
                date: results[i].date.format("YYYY-MM-DD HH:mm"),
				price: results[i].value.toFixed(2)
			})
        }

        _callback(arr)
    })
}

function removeUntilNow(arr) {
    const now = moment().format("HH00")

    for (let key in arr) {

        time = moment(arr[key].date).format("HHmm")
        
        if (time < now) {
            delete arr[key]
        }
    }

    return cleanArray(arr)
}

function removeAfter(hour, arr) {

    for (let key in arr) {

        time = moment(arr[key].date).format("HHmm")
        
        if (time > hour) {
            delete arr[key]
        }
    }

    return cleanArray(arr)
}

function cleanArray(arr) {
    console.log("Cleaning all deleted prices")
    return arr.filter(function(n){ return n != undefined });
}

function hoursNeeded() {

	api("UserLoginRequest", (json) => {
		if (json.VehicleInfoList) {
			sessionid = encodeURIComponent(json.VehicleInfoList.vehicleInfo[0].custom_sessionid)
			vin = encodeURIComponent(json.VehicleInfoList.vehicleInfo[0].vin)
		} else  {
			sessionid = encodeURIComponent(json.vehicleInfo[0].custom_sessionid)
			vin = encodeURIComponent(json.vehicleInfo[0].vin)
		}
		api("BatteryStatusCheckRequest", () => {
			console.log("Receiving data from car... (wait one minute)")
			setTimeout(() => {
				api("BatteryStatusRecordsRequest", (json) => {
					console.log(json)
					// console.log("Hours needed: " + json.BatteryStatusRecords.TimeRequiredToFull200.HourRequiredToFull)

					if(json.BatteryStatusRecords.PluginState == "NOT_CONNECTED") {
						console.log("Car not connected")
					} else {
						
						if(json.BatteryStatusRecords.BatteryStatus.BatteryChargingStatus == "NOT_CHARGING") {
							
							let hoursNeeded = json.BatteryStatusRecords.TimeRequiredToFull200.HourRequiredToFull

							// If there is need to charge, but not for a full hours
							if (hoursNeeded == 0) {
								hoursNeeded = 1
							}

							// Check to se if we need to add an extra hour, for shorter periods it's better to wait
							// Don't know if this can be the case, or if it always shows half hours
							if (json.BatteryStatusRecords.TimeRequiredToFull200.MinutesRequiredToFull > 40) {
								hoursNeeded += 1
							}

							console.log("Hours needed: " + hoursNeeded)
							return hoursNeeded

						} else {
							console.log("Car is already chargeing, can't stop it")
						}

					}
				})
			}, 60*1000) // wait 60 seconds to get info from car (40 s needed when last tested)
		})
		
	})
}

function api(action, _callback) {
	q = ""
	const region_code = "NE"

	// If action is login, then we need to set username and password
	if (action == "UserLoginRequest") {

		console.log("do login")

		const initial_app_strings = "geORNtsZe5I4lRGjG9GZiA"
		const username = process.env.USERNAME // Your NissanConnect username or email address.
		const password = encrypt(process.env.PASSWORD) // Your NissanConnect account password.

		function encrypt(password) {
			var e = new Encryption()
			return e.encrypt(password, "uyI5Dj9g8VCOFDnBRUbr3g")
		}

		q = "UserId=" + username + "&initial_app_strings=" + initial_app_strings + "&RegionCode=" + region_code + "&Password=" + password

	} else {

			q = "custom_sessionid=" + sessionid + "&RegionCode=" + region_code + "&VIN=" + vin

	} // if login

	let options = {
		hostname: "gdcportalgw.its-mo.com",
		port: 443,
		path: "/gworchest_160803EC/gdc/" + action + ".php",
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"Content-Length": Buffer.byteLength(q),
		}
	}

	let req = https.request(options, (res) => {
		//console.log(`${options.hostname}${options.path}?${q}`)
		//console.log(`${res.statusCode}: ${res.statusMessage}`)
		console.log(action)

		let respData = ""
		res.on('data', (d) => {
			//process.stdout.write(d)
			respData += d.toString()
		})

		res.on("end", () => {
			let json = respData && respData.length ? JSON.parse(respData) : null
			//console.log("response: " + respData)
			_callback(json)

		})

	})
	req.write(q)
	req.end()

} // function api()


function timeIsNow(allPrices, hoursNeeded) {

    allPrices.sort((a, b) => {
        return a.price-b.price
    })
    console.log("Best price first:")
    console.log(allPrices)
    
    const now = moment().format("HH00");

    for (let i = 0; i < hoursNeeded; i++) {
        time = moment(allPrices[i].date).format("HHmm");

        console.log("Charge at " + time + ", now is " + now)
        if (time == now) {
            
            return true
            break

        }
    }
}

function chargeNow() {
    console.log("Charge car now")
    // api("BatteryRemoteChargingRequest", () => {})
}