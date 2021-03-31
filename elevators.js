/* 
PROJECT SPECIFICATIONS:
    You've been hired by a construction firm to help build the "brain" for a set of elevators in a new building.

    The building has 10 floors, a lobby and a basement, call the floors -1...10

    The building has 2 elevators:
      Elevator A can go to all floors EXCEPT the penthouse (floor 10)
      Elevator B can go to all floors EXCEPT the basement (floor -1)

NOTES:
    - Promises used to create semaphores that control order of certain events.
    - Text files are included with this script to generate random passenger names for each passenger.
    - After a successful run, this script should create a log file corrisponding to each individual
    elevator shaft. These logs will be easier to read and understand than the standard console output.
*/

// events, promises used in semaphores
const EventEmitter = require('events');
const { resolve } = require('path');
// get data from text files containing the most common first in last names in North America
var fs = require('fs');
const fnames = fs.readFileSync('fnames.txt').toString().split("\n");
const lnames = fs.readFileSync('lnames.txt').toString().split("\n");

// pauses execution in order to simulate a re-world event that takes some time
function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms))}

// used control order of events in a given context
// can stop execution, wait for sleep events, other events to finish
function semaphore(numLocks){
  // numLocks = number of allowed concurrent events
  let locks = 0;
  let unlocker = new EventEmitter();

  function listen(resolve){
    // "listen" for resolve from other semaphores
    unlocker.once("", () => {
      if(locks < numLocks){
        locks++;
        resolve();
      } else {
        listen();
      }
    });
  }

  async function lock(){
    // wait until all locks are released before resolving
    return new Promise((resolve) => {
      if(locks < numLocks){
        locks++;
        resolve();
      } else { 
        listen(resolve);
      }
    });
  }

  async function unlock(){
    // release lock once task is complete
    locks--;
    unlocker.emit("");
  }

  return async function(codeblock){
    await lock(); // prevent codeblock until a lock is available
    await codeblock(); // execute passed codeblock
    await unlock(); // release lock, allow other waiting semephores to execute
  }
}

/**
 * A multi-storey structure with elevators.
 * There should only be one instance of building.
 * Building constructor will create elevator and floor classes.
 */
class Building {
  constructor(elevatorShafts){
    this.elevators = [];
    this.floors = [];

    // create elevator shafts
    for(let i=0; i < elevatorShafts.length; i++){
      let shaftNumber = (i+1).toString();
      this.elevators.push(new Elevator(this, shaftNumber, elevatorShafts[i]));
    }

    //get number of floors
    let numFloors = 0;
    for(let shaft of elevatorShafts){
      shaft.sort((a, b) => a - b); // make sure floors are in ascending order
      let highestFloor = Math.max(...shaft);
      if(highestFloor > numFloors){
        numFloors = highestFloor;
      }
    }

    //assume building has a single basement & a lobby
    this.floors.push(new Floor(this, "basement", -1, false, true));
    this.floors.push(new Floor(this, "lobby", 0, true, true));
    for(let i=1; i < numFloors; i++){
      this.floors.push(new Floor(this, `Floor ${i}`, i, true, true));
    }
    //assume the top floor is the "penthouse"
    this.floors.push(new Floor(this, "penthouse", numFloors, true, false))
  }
}

/**
 * A storey in the building.
 * If an elevator can access this floor, a floor class will be created.
 * It is possible that multiple elevators can visit a given floor.
 */
class Floor {
  constructor(building, name, index, hasDownBtn, hasUpBtn){
    this.building = building;
    this.name = name;
    this.index = index; //a shorthand representation of storey where -1 = basement, 0 = lobby etc.
    // top floor does not have up btn, bottom floor no down btn
    if(hasDownBtn){
      this.downBtn = false; //false = not pressed
    }
    if(hasUpBtn){
      this.upBtn = false;
    }
    this.passengersUp = [];
    this.passengersDown = [];
  }

  /**
   * Considering passenger direction, elevator direction and elevator future trip length,
   * detirmines which elevator will most efficiently transport passengers on this floor.
   * Run this after a Passenger has pressed one of this floor's call buttons.
   * @param {Building} building 
   * @param {Number} dest destination floor
   * @param {String} going ("up" or "down")
   */
  getBestElevator(going){
    // only consider elevators that go to this floor
    let validElevators = [];
    for(let e of this.building.elevators){
      if(e.availableFloors.indexOf(this.index) != -1){
        validElevators.push(e)
      }
    }
    // starting point: assume best elevator is that with the shortest queue
    let bestElevator = validElevators[0];
    for(let e of validElevators){
      //if a valid elevator has no jobs, request it
      if(e.requested.length === 0) {
        this.reqElevator(e);
        return;
      }
      if(e.requested.length < bestElevator.requested.length) bestElevator = e;
    }

    let bestProximity = Math.abs(bestElevator.currentFloor - this.index); 
    for(let e of validElevators){
      // an elevator is at this floor, waiting or going your way. ideal case.
      if(e.currentFloor === this.index && (e.direction === undefined || e.direction === going)){
        this.reqElevator(e); 
        return;
      } 
      // an elevator is already meant to visit this floor, just wait.
      else if(e.requested.indexOf(this.index) != -1) return;
      else {
        if(e.direction === going){
          // elevator may be close, heading towards your destination
          if((this.index >= e.currentFloor && going === "up") || (this.index <= e.currentFloor && going === "down")) updateBestElevator(e, this.index);
          else {
            // elevator passed your floor already
            // an elevator that has passed you will complete a full trip before your destinations align
            if((this.index >= e.currentFloor && going === "down")|| (this.index <= e.currentFloor && going === "up")) updateBestElevator(e, this.index, true, true);
          }
        } else {
          // this elevator may be getting closer, but it is not immediately heading towards your floor (directions different)
          // if it hasn't already, the elevator will need to pass you and change directions first
          if((this.index >= e.currentFloor && e.direction === "down") || (this.index <= e.currentFloor && e.direction === "up")) updateBestElevator(e, this.index, true);
          else{
            // directions different and elevator has passed your floor
            // elevator will switch directions then can pick up these passengers
            if((this.index >= e.currentFloor && e.direction === "up") || (this.index <= e.currentFloor && e.direction === "down")) updateBestElevator(e, this.index, true);
          }
        }
      }
      this.reqElevator(bestElevator);
    } 

    /**
     * Updates best elevator if correct conditions are met.
     * Considers the future trip length of elevator to detrimine which elevator will be 
     * able to most efficiently get passengers on this floor to their destination.
     * @param {Elevator} ele 
     * @param {Number} floor this floor number
     * @param {Boolean} passed 
     * @param {Boolean} completeTrip 
     */
    function updateBestElevator(ele, floor, passed = false, completeTrip = false){
      /* 
        this could be optimised further: 
        elevators that have passed may not necessarily visit the very bottom or very top floor
        this is an assumption made for simplicity
      */
      let tempProx = Math.abs(ele.currentFloor - floor);
      let additionalTripLength = 0;

      if(passed){
        // calculate distance between your floor and when elevator will change direction
        let beforeSwitch;
        let afterSwitch; 
        if(ele.direction == "down"){
          beforeSwitch = ele.availableFloors.indexOf(ele.currentFloor);
          afterSwitch = ele.availableFloors.indexOf(floor);
        } else if(ele.direction == "up"){
          beforeSwitch = ele.availableFloors.length - ele.availableFloors.indexOf(ele.currentFloor);
          afterSwitch = ele.availableFloors.length - ele.availableFloors.indexOf(floor);
        }
        additionalTripLength = beforeSwitch + afterSwitch;
      }

      if(completeTrip){
        additionalTripLength += ele.availableFloors.length;
      }

      if((tempProx + additionalTripLength) < bestProximity){
        bestProximity = tempProx;
        bestElevator = ele;
      }
    }   
  }

  /**
   * Appends floor index to elevator's queue so elevator will eventually 
   * travel to this floor.
   * @param {Elevator} ele 
   */
  async reqElevator(ele){
    ele.requested.push(this.index);
    let set = new Set(ele.requested); //remove duplicate requests in queue
    ele.requested = [...set];
    //move elevator if not moving
    if(ele.direction === undefined){
      ele.goToFloor(ele.getNextFloor());
    } 
  }

  /**
   * Condidering the intended direction of the passengers on the given
   * floor, returns a passenger appropriate for this trip.
   * @param {Floor} floor 
   */
  getNextLoadingPassenger(ele){
    if(ele.direction === undefined){
      if(this.passengersUp != undefined && this.passengersDown != undefined){
        if(this.passengersUp.length <= this.passengersDown.length){
          ele.direction = "down";
          return this.getNextValidPassenger(ele);
        } else {
          ele.direction = "up";
          return this.getNextValidPassenger(ele);
        } 
      } 
      else if(this.passengersDown === undefined && this.passengersUp.length > 0){
        ele.direction = "up";
        return this.getNextValidPassenger(ele);     
      } 
      else if(this.passengersUp === undefined && this.passengersDown.length > 0){
        ele.direction = "down";
        return this.getNextValidPassenger(ele);
      } 
    } else {
      return this.getNextValidPassenger(ele);
    }
  }

  getNextValidPassenger(ele){
    if(ele.direction === "up"){
      for(let p of this.passengersUp){
        let checkVisit = ele.availableFloors.indexOf(p.destination)
        if(checkVisit != -1){
          // this elevator does visit the passengers destination
          let passenger = p;
          console.log(`before ${this.passengersUp.map(p => p.name)}`);
          this.passengersUp.splice(1, this.passengersUp.indexOf(p));
          console.log(`after ${this.passengersUp.map(p => p.name)}, passenger ${passenger.name}`);
          return passenger;
        }
      }
      return false;
    } else if (ele.direction === "down"){
      for(let p of this.passengersDown){
        let checkVisit = ele.availableFloors.indexOf(p.destination)
        if(checkVisit != -1){
          // this elevator does visit the passengers destination
          let passenger = p;
          console.log(`before ${this.passengersDown.map(p => p.name)}`);
          this.passengersDown.splice(1, this.passengersDown.indexOf(p));
          console.log(`after ${this.passengersDown.map(p => p.name)}, passenger ${passenger.name}`);
          return passenger;
        } 
      }
    return false;
    }
  }
}

/**
 * A vehicle to move passengers up and down to different floors.
 * Stop execution when all elevators cannot find any new passengers to transport.
 * Each elevator will create its own log file to make reading individual logs easier. 
 */
class Elevator {
  constructor(building, shaft, availableFloors){
    this.building = building
    this.shaft = shaft // must be unique, only one elevator per shaft
    this.availableFloors = availableFloors; //array of floor indexes (-1 = basement, 0 = lobby,..)
    this.doorsOpen = false;
    this.maxPassengers = 10; // assume elevator has a weight restriction
    this.passengers = []; // contain passenger objects
    this.currentFloor = 0;
    //this.destination = 0; // next floor index to visit
    this.direction = undefined; //undefined = no where to go, "up" = up, "down" = down
    this.requested = []; // contain a unique list of floors to be visited.
    /* elevator related actions cannot happen concurrently
    events must happen exclusively one after another, hense 1 lock */
    this.action = semaphore(1);
    /* the doors of the elevator are wide enough for 2 people to pass
    through, so 2 concurrent load or unload events are possible */ 
    this.load = semaphore(2);
    // setup logging
    this.fileName = `Elevator-${this.shaft}.txt`
    fs.writeFileSync(this.fileName, ""); //overwrite (clear) any existing files
  }

  /**
   * Append msg to this elevator's log file
   * @param {String} msg 
   */
  writeLog(msg){
    fs.appendFile(this.fileName, `${msg}\n`, function (err) {
      if(err) throw err;
    })
  }

  /**
   * Opens the doors, loads and unloads passengers at this floor, closes the doors
   * @param {Floor} floor 
   */
  async loadPassengers(floor){
    /*
    loading may need to be changed, if 2 elevators arrive at this floor
    then they may both try to load the same passenger causing a conflict.
    */
    this.action(async () => {
      // first, wait for doors to open
      await this.openDoors(); //assume doors remain open for loading duration

      // begin load/unload
      await this.load(async () => {
        this.requested.splice(this.requested.indexOf(floor.index), 1); // remove this floor from elevator's requested floors
        console.log(`Elevator${this.shaft}, direction before ${this.direction}`);
        this.updateDirection(); // elevator could change directions at this point
        console.log(`Elevator${this.shaft}, direction after ${this.direction}`);

        // get passengers about to exit
        let exiting = [];
        for (let p of this.passengers){
          if (p.destination === this.currentFloor){
            exiting.push(p);
          }
        }

        // passengers exit first
        for(let p of exiting){
          await p.exitElevator(this);
        }

        let nextPassenger = floor.getNextLoadingPassenger(this);
        console.log(`nextPassenger ${nextPassenger}`);
        // while there are passengers on this floor, and the elevtor is not yet full, load passengers
        while((nextPassenger != false) && (this.passengers.length <= this.maxPassengers)){
          await nextPassenger.enterElevator(this, this.direction); // simulate passenger leaving floor, stepping on elevator
          this.requested = [... new Set(this.requested)]; // remove duplicates from requested floors

          //keep loading valid passengers until full
          if(this.passengers.length <= this.maxPassengers) nextPassenger = floor.getNextLoadingPassenger(this);
          else break;
        }
      })
    }); // done loading/unloading

    this.action(async () => {
      // wait for doors to close before doing something next
      await this.closeDoors();
      // clear elevator call
      if(this.direction == "down"){
        floor.downBtn = false;
        if(floor.passengersDown.length > 0){
          // not all passengers could fit on the elevator
          floor.passengersDown[0].request("down"); // simulate passenger pressing button again
        }       
      } else if(this.direction == "up"){
        floor.upBtn = false;
        if(floor.passengersUp.length > 0){
          // not all passengers could fit on the elevator
          floor.passengersUp[0].request("up"); // simulate passenger pressing button again
        }
      }
      // get next task
      this.goToFloor(this.getNextFloor());
    }); // done closing doors
  }

  /**
   * Sets elevator direction.
   * Run this each time the elevator stops, or has received a new job.
   */
  updateDirection(){
    let max = Math.max(...this.availableFloors);
    let min = Math.min(...this.availableFloors);

    if(this.requested.length > 0){ 
      let highestRequestedFloor = Math.max(...this.requested);
      let lowestRequestedFloor = Math.min(...this.requested);
      // elevator at the top floor, must do down
      if(this.currentFloor === max) this.direction = "down";
      // elevator at the bottom floor, must go up
      else if(this.currentFloor === min) this.direction = "up";
      else {
        if(this.currentFloor <= lowestRequestedFloor) this.direction = "up";
        else if(this.currentFloor >= highestRequestedFloor) this.direction = "down";
        else {
          // elevator should continue in its current direction until it has a need to change direction
          if(this.direction == "down" && this.currentFloor > lowestRequestedFloor) this.direction = "down";
          else if(this.direction == "up" && this.currentFloor < highestRequestedFloor) this.direction = "up";
        }
      }
    } else {
      // no one in the elevator, no one waiting for this elevator, wait.
      const msg = `Elevator ${this.shaft} - waiting for passengers...`;
      console.log(msg);
      this.writeLog(msg)
      this.direction = undefined;
    }
  }

  /**
   * Considering the elevator's queue, gets the best floor to travel to next.
   * @returns Floor object
   */
  getNextFloor(){
    //this.updateDirection();
    let nextFloor;
    if(this.requested.length === 0){
      // elevator queue is empty, wait at the current floor.
      const msg = `Elevator-${this.shaft} is waiting for passengers.`;
      console.log(msg);
      this.writeLog(msg);
      return this.building.floors[this.currentFloor+1];
    } else {
      nextFloor = this.getNextClosestFloor();
    }

    if(this.passengers.length === 10){
      // if the elevator is already full, dont pick up any new passengers
      return this.building.floors[nextFloor];
    } else {
      // otherwise, stop to pickup passengers along the way, if any
      if(this.direction === "down"){
        for(let f = this.currentFloor+1; f > nextFloor+1; f--){
          if(this.building.floors[f].passengersDown.length > 0){
            return this.building.floors[f];
          }
        }
      }
      if(this.direction === "up"){
        for(let f = this.currentFloor+1; f < nextFloor+1; f++){
          if(this.building.floors[f].passengersUp.length > 0){
            return this.building.floors[f];
          }
        }
      }
    }
    return this.building.floors[nextFloor+1];
  }

  /**
   * Considering the current direction of the elevator, get the
   * next closest floor in this direction. 
   * @returns (int) floor number
   */
  getNextClosestFloor(){
    // elevators prefer to continue in the same direction if there is a reason to
    let nextFloor = this.requested[0];
    if(this.direction === "down"){
      for(let f of this.requested){
        if(f <= this.currentFloor && f > nextFloor) nextFloor = f; 
      }
    } else if(this.direction === "up"){
      for(let f of this.requested){
        if(f >= this.currentFloor && f < nextFloor) nextFloor = f; 
      }
    } 
    return nextFloor;
  }

  /**
   * Simulates moving the elevator to the correct floor
   * Runs loadPassengers after arrival
   * @param {Floor} dest - destination floor
   */
  async goToFloor(dest){
    this.updateDirection();
    if(dest.index === this.currentFloor){
      //elevator already at the desired floor
      this.loadPassengers(dest);
    } else {
      if (this.doorsOpen){
        //saftey check, this should not be possible.
        console.log("ERROR - cannot move elevator while doors are open!");
        return;
      } else {    
        const msg = `Elevator ${this.shaft} - moving to floor ${dest.index}`;
        console.log(msg);
        this.writeLog(msg);
        await sleep(500); // additional time it takes for the elevator to accelerate
        // while elevator has not yet reached destination
        while (this.currentFloor != dest.index){
          // going up or down a storey takes an elevator 1 second
          if (this.currentFloor < dest.index){
            await sleep(1000);
            this.currentFloor++; // moving up floors
          } else if (this.currentFloor > dest.index){
            await sleep(1000);
            this.currentFloor--; // moving down
          }
          let logFloor = this.currentFloor;
          console.log(logFloor);
          this.writeLog(logFloor.toString());
        }
        await sleep(500);// additional time to decelerate
        const msg2 = `Elevator ${this.shaft} - arrived at floor ${dest.index}`;
        console.log(msg2);
        this.writeLog(msg2); 
        this.loadPassengers(dest);
      }
    }
  }

  /**
   * Simulates doors opening.
   * Using semaphores, forbids other elevator events until complete
   */
  async openDoors(){
    let msg = `Elevator ${this.shaft} - opening doors`;
    console.log(msg);
    this.writeLog(msg);
    await sleep(1000); //opening and closing doors takes 1s
    this.doorsOpen = true;
    msg = `Elevator ${this.shaft} - open.`;
    console.log(msg);
    this.writeLog(msg);
  }

  /**
   * Simulates doors closing.
   * Using semaphores, forbids other elevator events until complete
   */
  async closeDoors(){
    let msg = `Elevator ${this.shaft} - closing doors. Passengers: ${this.passengers.length}`;
    console.log(msg);
    this.writeLog(msg);
    this.doorsOpen = false;
    await sleep(1000); //opening and closing doors takes 1s
    msg = `Elevator ${this.shaft} - closed.`;
    console.log(msg);
    this.writeLog(msg);
  }
}

/**
 * A person who is trying to get to a different floor.
 * There can be any number of passengers.
 */
class Passenger {
  constructor(building, start, end){
    // generate a random passenger name
    this.name = (fnames[Math.floor(Math.random() * fnames.length)]).slice(0, -1) + " " + (lnames[Math.floor(Math.random() * lnames.length)]).slice(0, -1);
    // generate time it takes to get on/off an elevator, assume different people move faster than others (0.5 - 2.5 s)
    this.loadingSpeed = Math.floor(Math.random() * 2000) + 500 
    // passenger is linked with either a floor or an elevator object, not both at the same time
    this.floor = building.floors[start+1]
    this.elevator = undefined;
    this.building = building;
    // get direction
    this.destination = end;
    if(start > end) this.direction = "down";
    else if (start < end) this.direction = "up";
    else console.log(`${this.name} is already at their desired floor`); // sanity check, this should not happen
    // start trip clock
    this.startTime = new Date();
    this.tripTime = undefined;
    // request elevator
    if(this.direction == "up"){ 
      this.floor.passengersUp.push(this);
      this.request(this.direction)
    } else if (this.direction == "down"){
      this.floor.passengersDown.push(this);
      this.request(this.direction);
    }
    console.log(`${this.name} - ${start}, ${end}`);
  }

  /**
   * Runs getBestElevator if the floor's button is not yet pressed
   * @param {String} going ("up" or "down") 
   */
  request(going){
    if(going === "up" && this.floor.upBtn === false){
      this.floor.upBtn = true;
      this.floor.getBestElevator("up");
    } else if (going === "down" && this.floor.downBtn === false){
      this.floor.downBtn = true;
      this.floor.getBestElevator("down");
    } else {
      console.log(`elevator was not called`);
    }
  }

  /**
   * Simulates passenger stepping into passed elevator.
   * Clears passenger floor obj and removes passenger from floor's passengers
   * Sets passenger elevator obj
   * @param {Elevator} ele 
   */
  async enterElevator(ele, going){
    if (ele.doorsOpen){
      const msg = `   ${this.name} is entering Elevator-${ele.shaft}, going ${going}.`
      console.log(msg);
      ele.writeLog(msg);
      // remove this passenger from floor passengers
      if(going === "up") this.floor.passengersUp.splice(this.floor.passengersUp.indexOf(this), 1);
      else if(going === "down") this.floor.passengersDown.splice(this.floor.passengersDown.indexOf(this), 1);
      this.floor = undefined;      
      // associate with elevator 
      ele.passengers.push(this)
      this.elevator = ele;
      // simulate time passing as passenger steps on elevator
      await sleep(this.loadingSpeed); 
      // simulate passenger pressing floor button inside elevator
      ele.requested.push(this.destination); 
      // remove duplicate requests in queue (passenger destination may already be requested)
      let set = new Set(ele.requested); 
      ele.requested = [...set];
    } else {
      // sanity check, this should not be possible
      console.log(`${this.name} cannot enter the elevator - doors closed!`);
    }
  }

  /**
   * Simulates passenger stepping out of passed elevator.
   * Calculates and reports total trip time
   * @param {Elevator} ele 
   * @returns none
   */
  async exitElevator(ele){
    if(ele.doorsOpen){
      sleep(this.loadingSpeed);
      this.elevator = false;
      //calculate total ride time in seconds
      this.tripTime = (new Date() - this.startTime)/1000;
      //remove passenger from elevator passengers arr
      let index = ele.passengers.indexOf(this);
      ele.passengers.splice(index, 1);
      const msg = `   ${this.name} exits. Total trip time was ${this.tripTime} seconds`
      console.log(msg);
      ele.writeLog(msg);
    } else {
      console.log(`${this.name} cannot exit, doors are closed!`);
      return;
    }
  }
}

/**
 * Pass an object where all weights add to one, returns one of the passed keys.
 * @param {Object} prob key = possible result, value = weight
 * @returns one of passed object keys
 */
function weightedRandom(prob) {
  let i, sum=0, r=Math.random();
  for (i in prob) {
    sum += prob[i];
    if (r <= sum) return i;
  }
}

/**
 * Generates a random floor number that isnt 0
 * @param {Number} max highest floor 
 * @returns a floor number that isnt 0
 */
function anyExceptLobby(max){
  const prob = {"basement":0.05, "floor":0.9, "penthouse":0.05} //probabilities
  let destination = weightedRandom(prob);
  if(destination === "basement"){
    return -1;
  } else if(destination === "floor"){
    return Math.floor(Math.random() * max) - 1
  } else if(destination === "penthouse"){
    return max;
  }
}


function generateTrip(max){
  let a = 0, b = 0;
  const lobbyProb = {"lobby":0.8, "floor":0.2}

  do { // trips cannot start and end at the same floor
    if (weightedRandom(lobbyProb) === "lobby"){
      // there is a high likelyhood that any given trip will either start or end at the lobby.
      b = anyExceptLobby(max);
    } else {
      a = anyExceptLobby(max);
      b = anyExceptLobby(max);
    }
  // a trip to the same floor is not allowed (a === b)
  // a trip from the very top to the very bottom is not allowed
  } while ((a === b) && (Math.abs(a - b) != (max + 1))); 

  // chance to flip order
  if(Math.random() > 0.5){
    return [a, b]
  } else {
    return [b, a]
  }
}

async function elevatorSimulator(numPassengers, elevatorShafts){
  const hotel = new Building(elevatorShafts);

  /* TEST CASES */
  /*
  new Passenger(hotel, 2, 0);
  new Passenger(hotel, 0, 10);
  new Passenger(hotel, 6, 0);
  new Passenger(hotel, 5, 1);
  new Passenger(hotel, 3, 8);
  new Passenger(hotel, -1, 10); //shouldn't be possible in simulate
  */

  /* SIMULATE */

  // get highest floor, assume there is always one basement
  let highestFloor = 0;
  for(let s of elevatorShafts){
    let localMax = Math.max(...s);
    if(localMax > highestFloor) highestFloor = localMax;
  }


  for(let i=0; i<numPassengers; i++){
    const [start, end] = generateTrip(highestFloor)
    new Passenger(hotel, start, end)
    // sleep 2s before creating another passenger so that they are not all created at once.
    await new Promise( r => setTimeout(r, 2000));
  }
}

elevatorSimulator(25, 
  [
    [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 
    [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  ]
);
