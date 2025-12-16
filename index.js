const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const stripe = require('stripe')(process.env.PAYMENT_KEY);
const port = process.env.PORT || 3000;

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("Contesthub");
    const contestcollection = db.collection("contest");
    const paymentcollection = db.collection("payments");
    const taskcollection = db.collection("tasks")
    const usercollection=db.collection("User")

    await paymentcollection.createIndex({ tranjectionid: 1 }, { unique: true });

    app.get("/contests", async (req, res) => {
      const contests = await contestcollection.find().toArray();
      res.send(contests);
    });

    app.get("/top-contests", async (req, res) => {
      const top = await contestcollection.find().sort({ participantsCount: -1 }).limit(5).toArray();
      res.send(top);
    });


    app.post("/tasks", async (req, res) => {
      const task = req.body;
      
      try {
        const existingTask =await taskcollection.find({contest_id:task.contest_id})

        if(existingTask){
           return res.status(400).send({ message: "You have already submitted this task" });
        }


        const result = await taskcollection.insertOne(task)
        res.send(result)
      }
      catch (err) {
        res.status(500).send({ message: "Server error" });
      }
    })


    app.post("/user",async(req,res)=>{
      const user=req.body;
      try{
        const cakeuser=await usercollection.findOne({email:user.email})
        if(cakeuser){
          return res.status(400).send({message:" the user data alrady added"})
        }
        const result=await usercollection.insertOne(user)
        res.send(result)
      }
      catch(err){
        res.status(500).send({message:"server error"})
      }
    })



    app.post("/create-checkout-session", async (req, res) => {
      const { cost, email, id, name } = req.body;
      const amount = parseInt(cost) * 100;

      if (!amount || !email || !id) {
        return res.status(400).send({ error: "Invalid payment data" });
      }

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: { name },
            },
            quantity: 1,
          },
        ],
        customer_email: email,
        mode: "payment",
        metadata: { contestId: id.toString() },
        success_url: `${process.env.SITE_DOMAIN}/payment-success/${id}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-cancel/${id}`,
      });

      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (!session || session.payment_status !== "paid") {
          return res.status(400).send({ success: false, error: "Payment not completed" });
        }

        const transactionId = session.payment_intent;

        const alreadyPaid = await paymentcollection.findOne({ tranjectionid: transactionId });
        if (alreadyPaid) {
          return res.send({
            success: true,
            message: "Payment already processed",
            trackingid: alreadyPaid.trackingid,
            tranjectionid: alreadyPaid.tranjectionid
          });
        }

        const contestId = session.metadata.contestId;
        const trackingid = uuidv4();

        const contest = await contestcollection.findOne({ _id: new ObjectId(contestId) });
        if (!contest.paymentstatus || contest.paymentstatus !== "paid") {
          await contestcollection.updateOne(
            { _id: new ObjectId(contestId) },
            { $set: { paymentstatus: "paid", trackingid }, $inc: { participantsCount: 1 } }
          );
        }

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          Customer_email: session.customer_email,
          contest_id: contestId,
          paymentstatus: session.payment_status,
          tranjectionid: transactionId,
          paidat: new Date(),
          trackingid
        };

        await paymentcollection.insertOne(payment);

        res.send({
          success: true,
          trackingid,
          tranjectionid: transactionId
        });

      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, error: "Something went wrong" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("MongoDB connected successfully!");
  } finally { }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server running");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
