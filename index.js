const express = require('express')
const app = express()
const cors = require('cors');
require('dotenv').config();

const port =process.env.PORT || 3000

app.use(express.json())
app.use(cors())



const { MongoClient, ServerApiVersion } = require('mongodb');
const uri =process.env.MONGO_URI


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});





async function run() {
  try {
    await client.connect();

   const db=client.db("Contesthub");
   const contestcollection=db.collection("contest")



   app.get("/contests",async(req,res)=>{
    try{
        const contest=await contestcollection.find().toArray();
        res.send(contest)
    }
    catch(error){
        console.log(error)
        res.status(500).send({error:"failed to fetch contest"})
    }
   })


   app.get("/top-contests",async(req,res)=>{
    try{
        const top_contests=await contestcollection.find().sort({participantsCount:-1}).limit(5).toArray();
        res.send(top_contests)
    }
    catch{
        res.status(500).json({message:"server error"})
    }
   })





    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
