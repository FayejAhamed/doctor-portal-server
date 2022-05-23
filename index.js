const express = require('express')
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
var nodemailer = require('nodemailer');
var sgTransport = require('nodemailer-sendgrid-transport');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


const app = express()
const port = process.env.PORT || 5000;

app.use(cors())
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.s3ro3.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'UnAuthorized' })
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    });
}

//email sender 

const emailSenderOptions = {
    auth: {
        api_key: process.env.EMAIL_SENDER_KEY
    }
}
const emailClient = nodemailer.createTransport(sgTransport(emailSenderOptions));

function sendAppointmentEmail(booking) {
    console.log('sending email');
    const { patien, patienName, treatment, date, slot } = booking;

    var email = {
        from: process.env.EMAIL_SENDER,
        to: patien,
        subject: `Your Appoinment for ${treatment} is on ${date} at ${slot} is confirmed`,
        text: `Your Appoinment for ${treatment} is on ${date} at ${slot} is confirmed`,
        html: `
        <div>
        <p> Hello ${patienName},</p>
        <h3>Your Appoinment for ${treatment} is Confirmed</h3>
        <p>looking forward to see on${date} at ${slot} </P>
        <p>Our Address:</P>
        <p>Woodside, Quuens</P>
        <p>New York</P>
        <p>11377</P>
        <a href="https://web.programming-hero.com/">unsubscribed</a>
        </div>
        `
    };
    emailClient.sendMail(email, function (err, info) {
        if (err) {
            console.log(err);
        }
        else {
            console.log('Message sent: ', info);
        }
    });
}


function sendPaymentConfirmationEmail(booking) {
    console.log('sending email');
    const { patien, patienName, treatment, date, slot } = booking;

    var email = {
        from: process.env.EMAIL_SENDER,
        to: patien,
        subject: `We have recieved your payment for ${treatment} is on ${date} at ${slot} is confirmed`,
        text: `Your payment for this Appoinment ${treatment} is on ${date} at ${slot} is confirmed`,
        html: `
        <div>
        <p> Hello ${patienName},</p>
        <h3>Thank you for your payment. Your Appoinment for ${treatment} is Confirmed</h3>
        <p>looking forward to see on${date} at ${slot} </P>
        <p>Our Address:</P>
        <p>Woodside, Quuens</P>
        <p>New York</P>
        <p>11377</P>
        <a href="https://web.programming-hero.com/">unsubscribed</a>
        </div>
        `
    };
    emailClient.sendMail(email, function (err, info) {
        if (err) {
            console.log(err);
        }
        else {
            console.log('Message sent: ', info);
        }
    });
}



async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db("doctors_portal").collection("services");
        const bookingCollection = client.db("doctors_portal").collection("bookings");
        const userCollection = client.db("doctors_portal").collection("users");
        const doctorCollection = client.db("doctors_portal").collection("doctors");
        const paymentCollection = client.db("doctors_portal").collection("payments");

        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                return res.status(403).send({ message: 'forbiden access' })
            }
        }


        //payement 

        app.post('/create-payment-intent',verifyJWT, async (req, res) => {
            const service = req.body;
            const price = service.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({
                clientSecret: paymentIntent.client_secret
              });
        })

        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query);
            const services = await cursor.toArray();
            res.send(services)
        });

        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        });

        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin })
        })


        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' }
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);



        })


        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ result, token });
        })


        app.get('/available', async (req, res) => {
            const date = req.query.date;

            //step 1: get all services

            const services = await serviceCollection.find().toArray();
            //step:2 get the booking of the day
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();
            //step: 3  for each service ,
            services.forEach(service => {
                // step 4 :find bookings for that service

                const serviceBookings = bookings.filter(book => book.treatment === service.name);
                //step 5 : select slots for the service Booking : [""], [""]
                const bookedSlots = serviceBookings.map(book => book.slot);
                // step:6 select thos slots that are not bookedslots
                const available = service.slots.filter(slot => !bookedSlots.includes(slot));
                //step: 7 set available to slots to make it easier
                service.slots = available;
            })
            res.send(services);
        })

        //find booking with email
        app.get('/booking', verifyJWT, async (req, res) => {
            const patien = req.query.patien;
            const decodedEmail = req.decoded.email;
            if (patien === decodedEmail) {
                const query = { patien: patien };
                const bookings = await bookingCollection.find(query).toArray();
                return res.send(bookings);
            }
            else {
                return res.status(403).send({ message: 'forbiden access' })
            }

        });

        //find single booking with id from booking collection
        app.get('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
            res.send(booking)
        })


        //manage doctors
        app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctors = await doctorCollection.find().toArray();
            res.send(doctors);
        })


        //insert booking in db
        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking);
            sendAppointmentEmail(booking)
            return res.send({ success: true, result });
        });
        //update booking after payment

        app.patch('/booking/:id', verifyJWT, async(req, res)=>{
            const id = req.params.id;
            const payment = req.body;
            const filter = {_id: ObjectId(id)};
            const updatedDoc = {
                $set:{
                  paid: true, 
                  transactionId: payment.transactionId,
                }
            }

            const result = await paymentCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updatedDoc);
            res.send(updatedDoc);
        })

        // add new docotr in database
        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send(result)
        })

        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await doctorCollection.deleteOne(filter);
            res.send(result)
        })

    }
    finally {

    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello From doctors portal')
})

app.listen(port, () => {
    console.log(`doctors port app listening on port ${port}`)
})