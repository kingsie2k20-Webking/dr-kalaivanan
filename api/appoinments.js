
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  // CORS configuration
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method Not Allowed",
    });
  }

  try {
    // 1. Read Supabase environment variables
    const supabaseUrl =
      process.env.SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL;

    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing server-side Supabase settings.");

      return res.status(500).json({
        success: false,
        message: "Server database configuration is missing.",
      });
    }

    const supabase = createClient(
      supabaseUrl,
      supabaseKey
    );

    // 2. Read appointment details
    const {
      patient_name,
      phone,
      email,
      treatment,
      preferred_date,
      preferred_time,
      message,
    } = req.body || {};

    // 3. Validate required fields
    if (
      typeof patient_name !== "string" ||
      !patient_name.trim() ||
      typeof phone !== "string" ||
      !phone.trim() ||
      typeof treatment !== "string" ||
      !treatment.trim() ||
      typeof preferred_date !== "string" ||
      !preferred_date.trim() ||
      typeof preferred_time !== "string" ||
      !preferred_time.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Please fill in all required fields.",
      });
    }

    const cleanPhone = phone.trim().replace(/\D/g, "");

    if (cleanPhone.length !== 10) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10-digit phone number.",
      });
    }

    // 4. Save appointment to Supabase
    const { data, error } = await supabase
      .from("appointments")
      .insert([
        {
          patient_name: patient_name.trim(),
          email: email
            ? String(email).trim().toLowerCase()
            : null,
          phone: cleanPhone,
          reason_for_visit: treatment.trim(),
          appointment_date: preferred_date,
          appointment_time: preferred_time.trim(),
          message: message
            ? String(message).trim()
            : null,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to save appointment.",
      });
    }

    // 5. Send Telegram notification
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.DOCTOR_TELEGRAM_CHAT_ID;

    let telegramStatus = "not_configured";

    if (!botToken || !chatId) {
      console.error(
        "Missing TELEGRAM_BOT_TOKEN or DOCTOR_TELEGRAM_CHAT_ID."
      );
    } else {
      try {
        const telegramText =
          `🔔 NEW APPOINTMENT ALERT\n\n` +
          `📅 Date: ${preferred_date}\n` +
          `⏰ Time: ${preferred_time}\n` +
          `👤 Patient Name: ${patient_name.trim()}\n` +
          `📞 Phone: ${cleanPhone}\n` +
          `🩺 Reason for Visit: ${treatment.trim()}\n` +
          `📧 Email: ${email ? String(email).trim() : "Not provided"}\n` +
          `📝 Notes: ${message ? String(message).trim() : "None"}`;

        const telegramResponse = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              chat_id: chatId,
              text: telegramText,
            }),
          }
        );

        const telegramResult = await telegramResponse.json();

        if (telegramResponse.ok && telegramResult.ok) {
          telegramStatus = "sent";
          console.log("Telegram notification sent successfully.");
        } else {
          telegramStatus = "failed";

          console.error(
            "Telegram API error:",
            telegramResult.description || "Unknown Telegram error"
          );
        }
      } catch (telegramError) {
        telegramStatus = "failed";

        console.error(
          "Telegram request failed:",
          telegramError.message
        );
      }
    }

    // 6. Return appointment result
    return res.status(201).json({
      success: true,
      message: "Appointment submitted successfully.",
      data,
      telegramStatus,
    });

  } catch (err) {
    console.error("Appointment API error:", err.message);

    return res.status(500).json({
      success: false,
      message: "An unexpected server error occurred.",
    });
  }
}
