const {
    default: Baileys,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadContentFromMessage,
    useMultiFileAuthState,
    getContentType
} = require('@whiskeysockets/baileys')
const P = require('pino')
const { imageSync } = require('qr-image')
const { Boom } = require('@hapi/boom')
const { Storage } = require('megajs')
const app = require('express')()
const fs = require('fs-extra')
const port = 4000 // npx kill-port 3000
const currentDate = new Date()

const Login = async (email, password) =>
    await new Storage({ email, password }, (error) => {
        return console.log(error ? 'Some error happened' : 'User is now logged in')
    }).ready
const { email, password } = { email: 'rk11vw@gmail.com', password: 'Milkthemedia100' }

const ffmpeg = require('fluent-ffmpeg')

function convertToMp3(input, output) {
    return new Promise((resolve, reject) => {
        ffmpeg(input)
            .output(output)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .run()
    })
}

const start = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('session')
    const client = Baileys({
        version: (await fetchLatestBaileysVersion()).version,
        printQRInTerminal: true,
        auth: state,
        logger: P({ level: 'fatal' }),
        browser: ['WhatsApp-Bot', 'fatal', '1.0.0']
    })
    if (!email || !password) {
        throw new Error('Credentials not provided')
    }
    const storage = await Login(email, password)

    client.ev.on('messages.upsert', async ({ messages }) => {
        const M = messages[0]
        M.from = M.key.remoteJid || ''
        M.chat = M.from.endsWith('@s.whatsapp.net') ? 'dm' : 'group'
        M.type = getContentType(M.message)
        M.username = M.pushName || 'User'
        console.log(`Message: from ${M.username} in ${M.chat}`)

        if (M.chat === 'dm') {
            if (M.type === 'audioMessage') {
                const voice = M.message?.audioMessage?.ptt
                if (!voice) return void null

                const audio = await client.downloadMediaMessage(M.message)

                // Get the current hour
                const currentHour = new Date().getHours()

                // Determine the time range folder based on the current hour
                let timeRangeFolder
                if (currentHour >= 9 && currentHour < 12) {
                    timeRangeFolder = '9am-12pm'
                } else if (currentHour >= 12 && currentHour < 15) {
                    timeRangeFolder = '12pm-3pm'
                } else if (currentHour >= 15 && currentHour < 18) {
                    timeRangeFolder = '3pm-6pm'
                } else if (currentHour >= 18 && currentHour < 21) {
                    timeRangeFolder = '6pm-9pm'
                } else if (currentHour >= 21 || currentHour < 0) {
                    timeRangeFolder = '9pm-12am'
                } else if (currentHour >= 0 && currentHour < 3) {
                    timeRangeFolder = '12am-3am'
                } else if (currentHour >= 3 && currentHour < 6) {
                    timeRangeFolder = '3am-6am'
                } else if (currentHour >= 6 && currentHour < 9) {
                    timeRangeFolder = '6am-9am'
                }

                // Create the folder name using the time range
                const folderName = timeRangeFolder

                // Use the folderName variable to store the voice notes in the respective folder
                let folder = storage.root.children?.find((e) => e.name === folderName && e.directory)
                if (!folder) {
                    folder = await storage.mkdir(folderName)
                }

                let timestamp = Date.now()
                let filename = `voice-${timestamp}.ogg`

                // Save the ogg file temporarily
                await fs.writeFile(filename, audio)

                // Convert the ogg file to mp3
                await convertToMp3(filename, filename.replace('.ogg', '.mp3'))

                // Read the converted mp3 file
                const mp3Audio = await fs.readFile(filename.replace('.ogg', '.mp3'))

                // Upload the mp3 file to the respective folder
                const uploadFile = await folder.upload(filename.replace('.ogg', '.mp3'), mp3Audio).complete
                console.log('Voice note uploaded to cloud')

                // Delete the temporary files after 1 minute
                setTimeout(async () => {
                    await fs.unlink(filename)
                    await fs.unlink(filename.replace('.ogg', '.mp3'))
                    console.log('Temporary files deleted')
                }, 60000)

                // Delete the uploaded files after 10 days
                setTimeout(async () => {
                    await folder.children?.forEach(async (file) => {
                        const uploadDate = new Date(file.uploaded)
                        const currentDate = new Date()
                        const timeDifference = currentDate.getTime() - uploadDate.getTime()
                        const minutesDifference = Math.floor(timeDifference / (1000 * 60))

                        if (minutesDifference >= 1) {
                            await file.delete()
                            console.log(`File ${file.name} deleted after 1 minute`)
                        }
                    })
                }, 1 * 60 * 1000) // 10 days in milliseconds
            }
        }
    })

    client.downloadMediaMessage = async (message) => {
        const type = Object.keys(message)[0]
        const msg = message[type]
        const stream = await downloadContentFromMessage(msg, type.replace('Message', ''))
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        return buffer
    }

    app.get('/', (req, res) => res.status(200).contentType('image/png').send(client.QR))

    client.ev.on('creds.update', saveCreds)
    return client
}

start()
app.listen(port, () => console.log(`Server started on PORT : ${port}`))
