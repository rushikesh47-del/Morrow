import 'dotenv/config'
import process from 'node:process'
import app, { connectToMongoDB } from './index.js'

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001)

async function startServer() {
  try {
    await connectToMongoDB()
    console.info('MongoDB Atlas connected successfully')

    app.listen(port, '0.0.0.0', () => {
      console.info(
        `API server listening on http://localhost:${port}`
      )
    })
  } catch (error) {
    console.error(
      'MongoDB connection failed:',
      error?.message || error
    )

    process.exit(1)
  }
}

startServer()