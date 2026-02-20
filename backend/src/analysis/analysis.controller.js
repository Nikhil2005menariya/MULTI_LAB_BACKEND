const analysisService = require('./analysis.service');
const llmService = require('./llm.service');

/* ===============================
   ANALYSIS OVERVIEW (NO LLM)
=============================== */
exports.getAnalysisOverview = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;

    const [
      borrowActivity,
      mostBorrowedItems,
      lowStockItems,
      vendorDemand
    ] = await Promise.all([
      analysisService.getBorrowActivity(days),
      analysisService.getMostBorrowedItems(days),
      analysisService.getLowStockItems(),
      analysisService.getVendorDemand(days)
    ]);

    res.json({
      success: true,
      data: {
        days,
        borrowActivity,
        mostBorrowedItems,
        lowStockItems,
        vendorDemand
      }
    });

  } catch (err) {
    console.error('Analysis overview error:', err);
    res.status(500).json({ error: err.message });
  }
};


exports.getLLMReport = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;

    const analyticsData = {
        borrowActivity: await analysisService.getBorrowActivity(days),
        mostBorrowedItems: await analysisService.getMostBorrowedItems(days),
        lowStockItems: await analysisService.getLowStockItems(),
        vendorDemand: await analysisService.getVendorDemand(days),
        approvalQueue: await analysisService.getApprovalQueueStats(days)
    };


    const report = await llmService.generateInventoryReport(
      analyticsData,
      days
    );

    res.json({
      success: true,
      days,
      report
    });

  } catch (err) {
    console.error('LLM analysis error:', err);
    res.status(500).json({ error: err.message });
  }
};