const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash'
});

exports.generateInventoryReport = async (analyticsData, days) => {
  const prompt = `
You are an inventory analyst for a university IoT laboratory.

Analyze the following inventory data for the last ${days} days.
Do NOT repeat raw numbers.
Focus on insights, risks, and actionable recommendations.

DATA:
Borrow Activity Trend:
${JSON.stringify(analyticsData.borrowActivity)}

Most Borrowed Items:
${JSON.stringify(analyticsData.mostBorrowedItems)}

Low Stock Items:
${JSON.stringify(analyticsData.lowStockItems)}

Vendor Demand:
${JSON.stringify(analyticsData.vendorDemand)}

Approved but Pending Transactions (Queue Pressure):
${JSON.stringify(analyticsData.approvalQueue)}

Consider these as unmet demand due to stock or operational constraints.
If waiting time is high, recommend stock increases or process improvements.


OUTPUT FORMAT:
1. Overall Inventory Health
2. Items That Need Restocking
3. Vendor Recommendations
4. Risk & Observations
5. Short Action Plan (bullet points)
`;

  const result = await model.generateContent(prompt);
  return result.response.text();
};
