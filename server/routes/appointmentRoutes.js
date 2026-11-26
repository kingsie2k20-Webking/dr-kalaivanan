
const express = require("express");
const router = express.Router();

function formatAppointment(item) {
  if (!item) return item;

  return {
    ...item,
    _id: String(item.id),
    patientName: item.patient_name,
    appointmentDate: item.appointment_date,
    appointmentTime: item.appointment_time,
    createdAt: item.created_at,
  };
}

router.post("/", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;

    const {
      patient_name,
      patientName,
      email = "",
      phone,
      treatment,
      department,
      preferred_date,
      appointmentDate,
      preferred_time,
      appointmentTime = "",
      message = "",
    } = req.body;

    const resolvedName = patientName || patient_name;
    const resolvedDept = department || treatment;
    const resolvedDate = appointmentDate || preferred_date;
    const resolvedTime = appointmentTime || preferred_time || "";

    const errors = {};

    // 1. Validate Patient Name
    if (
      !resolvedName ||
      typeof resolvedName !== "string" ||
      resolvedName.trim().length < 2
    ) {
      errors.patient_name =
        "Please enter a valid patient name (at least 2 characters).";
    } else {
      const nameRegex = /^[a-zA-Z\s.]+$/;

      if (!nameRegex.test(resolvedName.trim())) {
        errors.patient_name =
          "Patient name can only contain letters and spaces.";
      }
    }

    // 2. Validate Phone Number
    if (!phone || typeof phone !== "string") {
      errors.phone = "Phone number is required.";
    } else {
      const cleanPhone = phone.trim().replace(/\D/g, "");

      if (cleanPhone.length !== 10) {
        errors.phone =
          "Please enter a valid 10-digit mobile number.";
      }
    }

    // 3. Validate Email Format (Optional)
    const trimmedEmail = email
      ? String(email).trim().toLowerCase()
      : "";

    if (trimmedEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailRegex.test(trimmedEmail)) {
        errors.email =
          "Please enter a correct email address format.";
      }
    }

    // 4. Validate Reason for Visit / Treatment
    if (
      !resolvedDept ||
      typeof resolvedDept !== "string" ||
      !resolvedDept.trim()
    ) {
      errors.treatment =
        "Please select a valid primary concern or reason for visit.";
    }

    // 5. Validate Preferred Date
    let appointmentDay;

    if (
      !resolvedDate ||
      typeof resolvedDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(resolvedDate)
    ) {
      errors.preferred_date = "Please enter a valid appointment date.";
    } else {
      const [y, m, d] = resolvedDate.split("-").map(Number);

      appointmentDay = new Date(y, m - 1, d);
      appointmentDay.setHours(0, 0, 0, 0);

      // Check whether the calendar date is valid
      if (
        appointmentDay.getFullYear() !== y ||
        appointmentDay.getMonth() !== m - 1 ||
        appointmentDay.getDate() !== d
      ) {
        errors.preferred_date = "Please enter a valid calendar date.";
      } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (appointmentDay < today) {
          errors.preferred_date =
            "You cannot book an appointment for a past date.";
        } else if (appointmentDay.getTime() === today.getTime() && resolvedTime) {
          // Check whether the selected time has already passed
          try {
            const timeStr = resolvedTime.trim();

            let hours = 0;
            let minutes = 0;

            const is12Hour = /AM|PM/i.test(timeStr);

            if (is12Hour) {
              const parts = timeStr.split(/\s+/);
              const [h, min] = parts[0].split(":").map(Number);
              const modifier = parts[1]?.toUpperCase();

              hours = h;

              if (modifier === "PM" && hours < 12) {
                hours += 12;
              }

              if (modifier === "AM" && hours === 12) {
                hours = 0;
              }

              minutes = min || 0;
            } else {
              const parts = timeStr.split(":");

              hours = parseInt(parts[0], 10) || 0;
              minutes = parseInt(parts[1], 10) || 0;
            }

            const appointmentDateTime = new Date(
              y,
              m - 1,
              d,
              hours,
              minutes,
              0,
              0
            );

            if (appointmentDateTime <= new Date()) {
              errors.preferred_time =
                "You cannot select a time slot that has already passed for today.";
            }
          } catch (err) {
            console.error("Time validation error:", err.message);
          }
        }
      }
    }

    // 6. Validate Preferred Time
    if (
      !resolvedTime ||
      typeof resolvedTime !== "string" ||
      !resolvedTime.trim()
    ) {
      errors.preferred_time = "Please select a valid time slot.";
    }

    // Return validation errors
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        message: "Failed to submit because of wrongly entered fields.",
        errors,
      });
    }

    const cleanPhone = phone.trim().replace(/\D/g, "");

    // 7. Save appointment to Supabase
    const { data, error } = await supabase
      .from("appointments")
      .insert([
        {
          patient_name: resolvedName.trim(),
          email: trimmedEmail,
          phone: cleanPhone,
          reason_for_visit: resolvedDept.trim(),
          appointment_date: resolvedDate,
          appointment_time: resolvedTime.trim(),
          message: message ? String(message).trim() : "",
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error.message);

      return res.status(400).json({
        errors: {
          form: error.message,
        },
      });
    }

    // 8. Send Telegram notification
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      // IMPORTANT: This must match the Vercel variable name
      const chatId = process.env.DOCTOR_TELEGRAM_CHAT_ID;

      if (!botToken || !chatId) {
        console.error(
          "Telegram configuration missing. Check TELEGRAM_BOT_TOKEN and DOCTOR_TELEGRAM_CHAT_ID."
        );
      } else {
        const telegramText =
          `🔔 New Appointment Alert\n\n` +
          `📅 Date: ${resolvedDate}\n` +
          `⏰ Time: ${resolvedTime}\n` +
          `👤 Patient Name: ${resolvedName.trim()}\n` +
          `📞 Phone: ${cleanPhone}\n` +
          `🩺 Reason for Visit: ${resolvedDept}\n` +
          `📧 Email: ${trimmedEmail || "Not provided"}\n` +
          `📝 Notes: ${message ? String(message).trim() : "None"}`;

        const response = await fetch(
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

        const result = await response.json();

        if (!response.ok || !result.ok) {
          console.error("Telegram API Error:", result);
        } else {
          console.log(
            "Telegram notification sent successfully!"
          );
        }
      }
    } catch (telegramError) {
      console.error(
        "Telegram notification failed:",
        telegramError.message
      );
    }

    // 9. Return successful appointment response
    return res.status(201).json(formatAppointment(data));

  } catch (err) {
    console.error("Appointment submission error:", err);

    return res.status(500).json({
      message: "An unexpected error occurred while submitting the appointment.",
    });
  }
});

module.exports = router;
