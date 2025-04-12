require('dotenv').config();
const fs = require('fs');
const path = require('path');
const appointmentsFile = path.join(__dirname, 'appointments.json');

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
// Persistent appointments array loaded from the file
let appointments = loadAppointmentsFromFile();

// Read appointments from the file (returns an array)
function loadAppointmentsFromFile() {
  try {
    const data = fs.readFileSync(appointmentsFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading appointments file:", err);
    return [];
  }
}

// Write appointments (array) to the file
function saveAppointmentsToFile(appointmentsArray) {
  try {
    fs.writeFileSync(appointmentsFile, JSON.stringify(appointmentsArray, null, 2));
  } catch (err) {
    console.error("Error writing appointments file:", err);
  }
}


// Middleware
app.use(express.json());

// Allow CORS if your front end runs on a different origin.
// Adjust the 'origin' value as needed or use '*' for all origins.
app.use(cors({
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

// Serve static files (e.g., the updated front end)
app.use(express.static(path.join(__dirname, 'public')));

console.log('Environment variables loaded:', {
  GREEN_API_ID: process.env.GREEN_API_ID,
  GREEN_API_TOKEN: process.env.GREEN_API_TOKEN,
  PORT: process.env.PORT
});

// WhatsApp Notification Function
async function sendAppointmentConfirmation(patientData) {
  try {
    if (!process.env.GREEN_API_ID || !process.env.GREEN_API_TOKEN) {
      throw new Error('WhatsApp API credentials not configured');
    }

    const rawPhone = String(patientData.phone).replace(/\D/g, '');
    if (rawPhone.length < 10) {
      throw new Error('Invalid phone number length');
    }
    const phoneWithCountryCode = rawPhone.startsWith('91') ? rawPhone : `91${rawPhone}`;
    const chatId = `${phoneWithCountryCode}@c.us`;

    const appointmentDate = new Date(`${patientData.date} ${patientData.time}`);
    if (isNaN(appointmentDate.getTime())) {
      throw new Error('Invalid appointment date or time');
    }

    let message;
    if (patientData.language === 'telugu') {
      message = `
      ప్రియమైన  ${patientData.name} గారు,

      మీ అపాయింట్‌మెంట్ నిర్ధారించబడింది:
      తేదీ: ${patientData.date}
      సమయం: ${patientData.time}

      దయచేసి మీ అపాయింట్‌మెంట్ సమయానికి 10 నిమిషాల ముందు రండి.
      ప్రదేశం: డీబీఆర్ హాస్పిటల్ రోడ్, శ్రీనివాసం వెనుక భాగంలో,
      నారాయణ జూనియర్ కాలేజీ ఎదుట, తిరుపతి - 517501

      మరింత సమాచారం కోసం మమ్మల్ని సంప్రదించండి.
      `;
    } else {
      message = `
      🏥 Appointment Confirmation
      Dear ${patientData.name},

      Your appointment has been confirmed:
      📅 Date: ${patientData.date}
      ⏰ Time: ${patientData.time}

      Please arrive 10 minutes before your scheduled time.
      Location: Dbr Hospital road, srinivasam back side,
          opp.Narayana jr.college, Tirupati-517501

      If you need to reschedule, please contact us.
      `;
    }

    const url = `https://api.green-api.com/waInstance${process.env.GREEN_API_ID}/sendMessage/${process.env.GREEN_API_TOKEN}`;
    const response = await axios.post(url, {
      chatId: chatId,
      message: message
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log("WhatsApp API Response:", response.data);
    return response.data;
  } catch (error) {
    console.error("WhatsApp Error Details:", {
      message: error.message,
      response: error.response?.data,
      config: error.config
    });
    throw new Error(`WhatsApp notification failed: ${error.message}`);
  }
}

// Routes
app.get('/', (req, res) => {
  res.send('Server is running!');
});

app.post('/api/appointments', async (req, res) => {
  try {
    console.log('Received appointment request:', req.body);
    const appointment = req.body;
    const requiredFields = ['name', 'phone', 'date', 'time', 'age', 'gender', 'problem'];
    const missingFields = requiredFields.filter(field => !appointment[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`,
        receivedData: appointment
      });
    }
    const cleanPhone = appointment.phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be at least 10 digits",
        receivedPhone: appointment.phone
      });
    }
    const appointmentId = Date.now();
    const savedAppointment = { 
      ...appointment, 
      id: appointmentId,
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    // Add the new appointment to the persistent appointments array
     appointments.push(savedAppointment);
       // Persist the updated appointments array to the file
      saveAppointmentsToFile(appointments);

    try {
      const whatsappResponse = await sendAppointmentConfirmation(savedAppointment);
      return res.status(201).json({
        success: true,
        id: appointmentId,
        message: "Appointment booked successfully! WhatsApp confirmation sent.",
        whatsappResponse: whatsappResponse
      });
    } catch (whatsappError) {
      console.error("WhatsApp notification failed, but saving appointment:", whatsappError);
      return res.status(201).json({
        success: true,
        id: appointmentId,
        message: "Appointment booked but WhatsApp notification failed. " + whatsappError.message
      });
    }
  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error: " + error.message
    });
  }
});

app.get('/api/appointments', async (req, res) => {
  try {
    const appointmentList = Array.from(appointments.values());
    res.json(appointmentList);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching appointments",
      error: error.message
    });
  }
});

app.put('/api/appointments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Find the appointment in the array
    const index = appointments.findIndex(app => app.id.toString() === id);
    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found"
      });
    }
    const updatedAppointment = { ...appointments[index], ...req.body };
    appointments[index] = updatedAppointment;
    // Save changes to file
    saveAppointmentsToFile(appointments);
    res.json({
      success: true,
      message: "Appointment updated successfully",
      appointment: updatedAppointment
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating appointment",
      error: error.message
    });
  }
});


app.delete('/api/appointments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const initialLength = appointments.length;
    appointments = appointments.filter(app => app.id.toString() !== id);
    if (appointments.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found"
      });
    }
    // Save updated appointments array to file
    saveAppointmentsToFile(appointments);
    res.json({
      success: true,
      message: "Appointment deleted successfully"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting appointment",
      error: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: err.message
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('WhatsApp API configured with ID:', process.env.GREEN_API_ID);
});
